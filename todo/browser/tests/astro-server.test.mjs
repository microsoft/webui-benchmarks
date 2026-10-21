// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:http2";
import { Server } from "node:net";
import process from "node:process";
import test from "node:test";
import { startFullstackH2Server } from "../fullstack-h2-server.mjs";

test("Astro serves its production routes over H2 without a second listener", {
  timeout: 30_000,
}, async (context) => {
  const listen = context.mock.method(Server.prototype, "listen");
  const autostart = process.env.ASTRO_NODE_AUTOSTART;
  let client;
  try {
    const server = await startFullstackH2Server({ appId: "astro", port: 0 });
    assert.equal(process.env.ASTRO_NODE_AUTOSTART, autostart);
    assert.equal(listen.mock.callCount(), 1);
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address !== null);
    client = connect(`https://127.0.0.1:${address.port}`, {
      rejectUnauthorized: false,
    });
    await once(client, "connect");
    assert.equal(client.alpnProtocol, "h2");
    for (const route of ["cached", "dynamic", "activity", "settings"]) {
      const request = client.request({ ":path": `/${route}` });
      const response = once(request, "response");
      const end = once(request, "end");
      let html = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        html += chunk;
      });
      request.end();
      const [headers] = await response;
      await end;
      assert.equal(headers[":status"], 200, route);
      assert.equal(headers["content-encoding"], undefined);
      if (route === "cached" || route === "dynamic") {
        assert.match(html, /todo-0001/u);
      } else {
        assert.ok(html.includes(`data-route-page="${route}"`), route);
      }
    }
  } finally {
    client?.destroy();
    await Promise.all(listen.mock.calls.map(({ this: server }) =>
      new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      })
    ));
  }
});
