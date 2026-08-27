// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { Protocol } from "@microsoft/webui";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "../build.mjs";
import { build as buildWebUi } from "../../webui-lightdom/build.mjs";
import { createTodoState } from "../../../shared/state.mjs";

test("builds a distinct FAST V3 protocol for the shared todo contract", async () => {
  const [fast, webui] = await Promise.all([build(), buildWebUi()]);
  const protocol = new Protocol(fast.protocol, { plugin: "fast-v3" });
  const html = protocol.render(
    createTodoState(0),
    { requestPath: "/dynamic" },
  ).toString("utf8");

  assert.ok(fast.protocol.byteLength > 0);
  assert.notDeepEqual(Buffer.from(fast.protocol), Buffer.from(webui.protocol));
  assert.match(html, /<todo-app\b/u);
  assert.match(html, /data-action="workspace-search"/u);
  assert.match(html, /\sdata-fe="/u);
  assert.equal(fast.cssFiles.length, 34);
});

test("defines a FASTElement class for every component", async () => {
  const sourceRoot = new URL("../src/", import.meta.url);
  const componentDirectories = await readdir(sourceRoot, {
    withFileTypes: true,
  });

  const typescript = [];
  for (const directory of componentDirectories) {
    if (!directory.isDirectory()) continue;
    const files = await readdir(new URL(`${directory.name}/`, sourceRoot));
    typescript.push(
      ...files
        .filter((file) => file.endsWith(".ts"))
        .map((file) => `${directory.name}/${file}`),
    );
  }
  assert.deepEqual(typescript.sort(), [
    "activity-page/activity-page.ts",
    "app-shell/app-shell.ts",
    "setting-toggle/setting-toggle.ts",
    "settings-page/settings-page.ts",
    "todo-app/todo-app.ts",
    "todo-badge/todo-badge.ts",
    "todo-button/todo-button.ts",
    "todo-checkbox/todo-checkbox.ts",
    "todo-filter/todo-filter.ts",
    "todo-footer/todo-footer.ts",
    "todo-header/todo-header.ts",
    "todo-item/todo-item.ts",
    "todo-list/todo-list.ts",
    "todo-summary/todo-summary.ts",
    "todo-tag-list/todo-tag-list.ts",
    "todo-toolbar/todo-toolbar.ts",
    "workspace-intelligence/workspace-intelligence.ts",
  ]);

  const definitions = await readFile(
    new URL("../component-definitions.ts", import.meta.url),
    "utf8",
  );
  const browserEntry = await readFile(
    new URL("../browser-entry.ts", import.meta.url),
    "utf8",
  );
  const authoredSources = await Promise.all(
    typescript.map((component) =>
      readFile(new URL(component, sourceRoot), "utf8")
    ),
  );
  const registrationSources = [
    definitions,
    browserEntry,
    ...authoredSources,
  ].join("\n");
  for (const component of typescript) {
    const source = await readFile(new URL(component, sourceRoot), "utf8");
    assert.match(source, /extends FASTElement/u);
    assert.match(source, /\.define\(/u);
    assert.match(
      registrationSources,
      new RegExp(component.replace(/\.ts$/u, "\\.js"), "u"),
    );
  }
});

test("settings route renders enabled checkboxes before hydration", async () => {
  const result = await build();
  const protocol = new Protocol(result.protocol, { plugin: "fast-v3" });
  const html = protocol.render(
    createTodoState(0).settings,
    { requestPath: "/settings" },
  ).toString("utf8");
  assert.equal(
    [...html.matchAll(/<input[^>]*\schecked(?:\s|>)/gu)].length,
    5,
  );
});
