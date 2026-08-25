// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "../build.mjs";
import { build as buildWebUi } from "../../webui/build.mjs";

test("builds a distinct FAST V3 protocol for the shared todo contract", async () => {
  const [fast, webui] = await Promise.all([build(), buildWebUi()]);
  const protocolText = Buffer.from(fast.protocol).toString("utf8");

  assert.ok(fast.protocol.byteLength > 0);
  assert.notDeepEqual(Buffer.from(fast.protocol), Buffer.from(webui.protocol));
  assert.match(protocolText, /<f-template name="todo-app">/u);
  assert.match(protocolText, /@click="\{onClick\(\$e\)\}"/u);
  assert.equal(fast.cssFiles.length, 24);
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
  ]);

  const definitions = await readFile(
    new URL("../component-definitions.ts", import.meta.url),
    "utf8",
  );
  for (const component of typescript) {
    const source = await readFile(new URL(component, sourceRoot), "utf8");
    assert.match(source, /extends FASTElement/u);
    assert.match(source, /\.define\(/u);
    assert.match(
      definitions,
      new RegExp(component.replace(/\.ts$/u, "\\.js"), "u"),
    );
  }
});
