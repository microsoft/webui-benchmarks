// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./dist/server/entry.mjs", import.meta.url);
const output = new URL("./dist/server/h2-entry.mjs", import.meta.url);
const source = await readFile(path, "utf8");
const withoutAutostart = source
  .replace(
    /const _start = 'start';\s*if \(Object\.prototype\.hasOwnProperty\.call\(serverEntrypointModule, _start\)\) \{\s*serverEntrypointModule\[_start\]\(_manifest, _args\);\s*\}/u,
    "",
  )
  .replace(
    /if \(process\.env\.ASTRO_NODE_AUTOSTART !== "disabled"\) startServer\(\);/u,
    "",
  );
if (withoutAutostart === source) {
  throw new Error("Astro H2 build could not remove standalone auto-start");
}
await writeFile(output, withoutAutostart, "utf8");
