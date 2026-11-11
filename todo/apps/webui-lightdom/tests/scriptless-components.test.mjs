// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { COMPONENTS } from "../../../shared/contract.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("only interaction-owning components have authored TypeScript", async () => {
  const interactiveComponents = new Set([
    "todo-app",
    "workspace-intelligence",
  ]);
  for (const tagName of COMPONENTS) {
    const sourceRoot = resolve(appRoot, "src", tagName, tagName);
    const hasBehavior = existsSync(`${sourceRoot}.ts`);
    const ownsInteractions = interactiveComponents.has(tagName);
    assert.equal(
      hasBehavior,
      ownsInteractions,
      `${tagName} should ${ownsInteractions ? "" : "not "}have authored behavior`,
    );
    const template = await readFile(`${sourceRoot}.html`, "utf8");
    assert.equal(
      /@[a-z-]+=/u.test(template),
      ownsInteractions,
      `${tagName} event ownership must match its authored behavior module`,
    );
  }
});

test("the browser component entry imports only authored behavior", async () => {
  const entry = await readFile(
    resolve(appRoot, "component-definitions.ts"),
    "utf8",
  );
  assert.match(entry, /lazy-hydration\.js/u);
  assert.match(entry, /app-shell\/app-shell\.js/u);
  assert.match(entry, /todo-app\/todo-app\.js/u);
  assert.match(entry, /workspace-intelligence\/workspace-intelligence\.js/u);
  assert.doesNotMatch(
    entry,
    /todo-(?:button|checkbox|filter|footer|header|item|list|summary|tag-list|toolbar)\//u,
  );
});

test("todo rows use reserved viewport rendering and hydration", async () => {
  const template = await readFile(
    resolve(appRoot, "src", "todo-item", "todo-item.html"),
    "utf8",
  );
  assert.match(template, /w-render="lazy"/u);
  assert.match(template, /w-reserve-block-size="18rem"/u);
  assert.doesNotMatch(template, /w-hydrate="lazy"/u);
});

test("the app shell defers its authored graph until interaction", async () => {
  const [template, entry] = await Promise.all([
    readFile(
      resolve(appRoot, "src", "app-shell", "app-shell.html"),
      "utf8",
    ),
    readFile(resolve(appRoot, "browser-entry.ts"), "utf8"),
  ]);
  assert.equal(
    existsSync(resolve(appRoot, "src", "app-shell", "app-shell.ts")),
    true,
  );
  assert.match(template, /w-hydrate="interaction"/u);
  assert.match(template, /<boundary name="navigation-ready">/u);
  assert.match(entry, /installInteractionHydration/u);
  assert.match(entry, /routePreload/u);
  assert.match(entry, /wakeInteractionHydration/u);
  assert.match(entry, /import\("\.\/component-definitions\.js"\)/u);
  assert.doesNotMatch(entry, /^import \{ Router \}/mu);
});

test("the streamed Work route flushes the workbench before the todo list", async () => {
  const [entry, template] = await Promise.all([
    readFile(resolve(appRoot, "src", "index.html"), "utf8"),
    readFile(
      resolve(appRoot, "src", "todo-app", "todo-app.html"),
      "utf8",
    ),
  ]);
  assert.match(
    entry,
    /<script type="module" async src="\/__browser\/webui\.js"><\/script>/u,
  );
  const boundary = template.indexOf(
    '<boundary name="workbench-ready" key="{{variantLabel}}">',
  );
  const workbench = template.indexOf("<workspace-intelligence");
  const boundaryClose = template.indexOf("</boundary>", workbench);
  const todoList = template.indexOf("<todo-list");
  assert.ok(boundary !== -1 && boundary < workbench);
  assert.ok(workbench < boundaryClose && boundaryClose < todoList);
});

test("workspace feature libraries load only for their interaction", async () => {
  const source = await readFile(
    resolve(
      appRoot,
      "src",
      "workspace-intelligence",
      "workspace-intelligence.ts",
    ),
    "utf8",
  );
  for (const feature of [
    "workspace-search",
    "workspace-csv",
    "workspace-saved-view",
    "workspace-analytics",
    "workspace-schedule",
  ]) {
    assert.match(source, new RegExp(`import\\([^)]*${feature}`, "u"));
  }
  assert.doesNotMatch(source, /from .*workspace-intelligence\.mjs/u);
});
