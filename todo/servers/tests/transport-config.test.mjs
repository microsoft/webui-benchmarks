// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rustServers = [
  new URL("../rust-actix/src/lib.rs", import.meta.url),
  new URL(
    "../rust-actix/examples/todo_profile_server.rs",
    import.meta.url,
  ),
];

test("every Actix server disables Nagle delay", async () => {
  for (const path of rustServers) {
    const source = await readFile(path, "utf8");
    const servers = source.match(/\bHttpServer::new\b/gu) ?? [];
    const noDelay = source.match(/\.tcp_nodelay\(true\)/gu) ?? [];
    assert.equal(
      noDelay.length,
      servers.length,
      `${path.pathname} must enable TCP_NODELAY on every Actix server`,
    );
  }
});
