// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createDemoHost } from "../host.mjs";

function product(id, appId = "shared-app") {
  return Object.freeze({ appId, id, streaming: "buffered" });
}

test("products and browser clients start lazily and only once", async () => {
  const builds = [];
  const launches = [];
  const stopped = [];
  const host = createDemoHost({
    buildClientForApp: async (appId) => {
      builds.push(appId);
      return { assetDirectory: undefined, assets: new Map() };
    },
    launch: async (entry, client) => {
      launches.push({ client, product: entry });
      return {
        assets: client.assets,
        origin: `http://127.0.0.1/${entry.id}`,
        product: entry,
        stop: async () => stopped.push(entry.id),
      };
    },
    registry: {},
  });
  const first = product("first");
  const second = product("second");

  assert.equal(host.hosted.size, 0);
  const [firstLaunch, duplicateLaunch] = await Promise.all([
    host.ensureHosted(first),
    host.ensureHosted(first),
  ]);
  assert.equal(firstLaunch, duplicateLaunch);
  assert.equal(host.hosted.size, 1);
  await host.ensureHosted(second);

  assert.deepEqual(builds, ["shared-app"]);
  assert.deepEqual(launches.map(({ product: entry }) => entry.id), [
    "first",
    "second",
  ]);

  await host.stopAll();
  assert.deepEqual(stopped.sort(), ["first", "second"]);
  assert.equal(host.hosted.size, 0);
});
