// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import test from "node:test";
import {
  COMPONENTS,
  COMPONENT_GRAPH,
  INTERACTIONS,
} from "../../../shared/contract.mjs";
import {
  APP_ID,
  APP_ROOT,
  componentPath,
  readAuthoredSources,
  symbolName,
} from "./support.mjs";

const RUNTIME = Object.freeze({
  clientModule: "react-dom/client",
  hydrateSymbol: "hydrateRoot",
  serverModule: "react-dom/server",
  serverSymbol: "renderToString",
});

/** Element factories that would mean the graph is not authored as real JSX. */
const BANNED_SOURCE_PATTERNS = Object.freeze([
  /\bcreateElement\b/u,
  /\bcloneElement\b/u,
  /\bh\(/u,
  /\bjsxs?\(/u,
  /\b_jsxs?\b/u,
  /\binnerHTML\b/u,
  /`\s*</u,
]);

const sources = await readAuthoredSources();

test(`${APP_ID}: every contract component is an authored .jsx module`, () => {
  for (const componentName of COMPONENTS) {
    const path = componentPath(componentName);
    assert.ok(existsSync(path), `missing ${componentName}.jsx`);
    assert.ok(
      !existsSync(resolve(APP_ROOT, "components", `${componentName}.mjs`)),
      `${componentName}.mjs must not shadow the JSX source`,
    );
    const source = sources.get(path);
    assert.ok(
      source.includes(`export function ${symbolName(componentName)}(`),
      `${componentName}.jsx must export a functional component`,
    );
    assert.ok(
      source.includes(`<${componentName}`),
      `${componentName}.jsx must author the <${componentName}> element in JSX`,
    );
    assert.ok(
      source.includes(`data-component="${componentName}"`),
      `${componentName}.jsx must keep its data-component marker`,
    );
    assert.match(
      source,
      /return \(?\s*</u,
      `${componentName}.jsx must return JSX, not a factory call`,
    );
  }
});

test(`${APP_ID}: the source-level component graph is preserved`, () => {
  for (const [parent, children] of Object.entries(COMPONENT_GRAPH)) {
    const source = sources.get(componentPath(parent));
    for (const child of children) {
      assert.ok(
        source.includes(`./${child}.jsx`),
        `${parent}.jsx must import ./${child}.jsx`,
      );
      assert.ok(
        source.includes(`<${symbolName(child)}`),
        `${parent}.jsx must render <${symbolName(child)}> as JSX`,
      );
    }
  }
});

test(`${APP_ID}: components own the interaction surface`, () => {
  for (const interaction of INTERACTIONS) {
    const source = sources.get(componentPath(interaction.component));
    assert.ok(
      source.includes(`data-action="${interaction.id}"`) ||
        source.includes(`action="${interaction.id}"`),
      `${interaction.component}.jsx must own the "${interaction.id}" action`,
    );
    assert.ok(
      /on(Click|Change|Action)=\{/u.test(source),
      `${interaction.component}.jsx must bind a JSX event handler`,
    );
  }
  const appSource = sources.get(componentPath("todo-app"));
  assert.ok(
    appSource.includes("useState"),
    "todo-app.jsx must hold interactive client state",
  );
  for (const handler of [
    "handleFilter",
    "handleSelect",
    "handleToggleCompletion",
    "handleClearCompleted",
  ]) {
    assert.ok(appSource.includes(handler), `todo-app.jsx must define ${handler}`);
  }
});

test(`${APP_ID}: no manual element APIs or string templates in app source`, () => {
  for (const [path, source] of sources) {
    for (const pattern of BANNED_SOURCE_PATTERNS) {
      assert.ok(
        !pattern.test(source),
        `${basename(path)} must not use ${pattern} (authored JSX only)`,
      );
    }
  }
});

test(`${APP_ID}: every authored source carries the license header`, () => {
  for (const [path, source] of sources) {
    assert.ok(
      source.replaceAll("\r\n", "\n").startsWith(
        "// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT license.\n",
      ),
      `${basename(path)} is missing the license header`,
    );
  }
});

test(`${APP_ID}: server and client entries use the framework SSR and hydration APIs`, () => {
  const server = sources.get(resolve(APP_ROOT, "server.jsx"));
  assert.ok(
    server.includes(`from "${RUNTIME.serverModule}"`),
    `server.jsx must import ${RUNTIME.serverModule}`,
  );
  assert.ok(
    server.includes(`${RUNTIME.serverSymbol}(`),
    `server.jsx must call ${RUNTIME.serverSymbol}`,
  );
  assert.ok(
    server.includes("<WorkspaceApp state={state} />"),
    "server.jsx must render the routed JSX root component",
  );

  const client = sources.get(resolve(APP_ROOT, "client.jsx"));
  assert.ok(
    client.includes(`from "${RUNTIME.clientModule}"`),
    `client.jsx must import ${RUNTIME.clientModule}`,
  );
  assert.ok(
    client.includes(`${RUNTIME.hydrateSymbol}(`),
    `client.jsx must call ${RUNTIME.hydrateSymbol}`,
  );
  assert.ok(
    client.includes("hydrateTodoApp"),
    "client.jsx must export hydrateTodoApp",
  );
});
