// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createDemoHost } from "../host.mjs";

function product(id, appId = "shared-app") {
  return Object.freeze({ appId, id, streaming: "buffered" });
}

test("the host deduplicates product and browser client startup", async () => {
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
  assert.equal(host.isReady(), false);
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
  assert.equal(host.isReady(), false);
});

test("prepareAll launches and warms every product before becoming ready", async () => {
  const warmed = [];
  const host = createDemoHost({
    buildClientForApp: async () => ({
      assetDirectory: undefined,
      assets: new Map(),
    }),
    launch: async (entry, client) => ({
      assets: client.assets,
      origin: `http://127.0.0.1/${entry.id}`,
      product: entry,
      stop: async () => {},
    }),
    registry: {},
    warm: async (entry, requests) => warmed.push([entry.product.id, requests]),
  });
  const products = [product("first"), product("second")];

  await host.prepareAll(products);

  assert.equal(host.isReady(), true);
  assert.equal(host.hosted.size, products.length);
  assert.deepEqual(warmed.sort(), [["first", 3], ["second", 3]]);
  await host.stopAll();
});
