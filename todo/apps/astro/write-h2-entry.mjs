// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./dist/server/entry.mjs", import.meta.url);
const output = new URL("./dist/server/h2-entry.mjs", import.meta.url);
const source = await readFile(path, "utf8");
const autoStartPatterns = [
  /const _start = 'start';\s*if \(Object\.prototype\.hasOwnProperty\.call\(serverEntrypointModule, _start\)\) \{\s*serverEntrypointModule\[_start\]\(_manifest, _args\);\s*\}/u,
  /if \(process\.env\.ASTRO_NODE_AUTOSTART !== "disabled"\) startServer\(\);/u,
];
const withoutAutostart = autoStartPatterns.reduce(
  (entry, pattern) => entry.replace(pattern, ""),
  source,
);
if (withoutAutostart === source) {
  throw new Error("Astro H2 build could not remove standalone auto-start");
}
await writeFile(output, withoutAutostart, "utf8");
