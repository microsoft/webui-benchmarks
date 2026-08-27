// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "../build.mjs";
import { build as buildLight } from "../../webui-lightdom/build.mjs";

test("builds a distinct Shadow DOM protocol from the shared WebUI source", async () => {
  const [shadow, lightBuild] = await Promise.all([build(), buildLight()]);
  const light = await readFile(
    new URL("../../webui-lightdom/dist/protocol.bin", import.meta.url),
  );
  assert.ok(shadow.protocol.byteLength > 0);
  assert.notDeepEqual(Buffer.from(shadow.protocol), light);
  assert.ok(lightBuild.cssFiles.includes("todo-app.css"));
  assert.ok(shadow.cssFiles.includes("todo-app.css"));
  assert.ok(shadow.cssFiles.length > lightBuild.cssFiles.length);
});
