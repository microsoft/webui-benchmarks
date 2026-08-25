// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { TODO_STATE_VARIANTS } from "../../shared/state.mjs";
import { createRouteController } from "./contract.mjs";
import { runtimeVersion } from "./runtime.mjs";
import { createWebuiRouteController } from "./webui-engine.mjs";

const adapterLoaders = Object.freeze({
  preact: () => import("../../apps/preact/adapter.mjs"),
  react: () => import("../../apps/react/adapter.mjs"),
  solid: () => import("../../apps/solid/adapter.mjs"),
  vue: () => import("../../apps/vue/adapter.mjs"),
  webui: () => import("../../apps/webui/adapter.mjs"),
});

export const RENDERER_IDS = Object.freeze(
  Object.keys(adapterLoaders),
);

export async function createAdapterRouteController({
  addonPath = undefined,
  appId,
  serverId = "node-http",
}) {
  if (!Object.hasOwn(adapterLoaders, appId)) {
    throw new RangeError(
      `Unknown product renderer '${appId}'. Expected one of: ${RENDERER_IDS.join(", ")}`,
    );
  }
  if (appId === "webui") {
    return createWebuiRouteController({
      addonPath,
      runtimeId: "node",
      serverId,
    });
  }

  process.env.NODE_ENV = "production";
  const adapter = await adapterLoaders[appId]();
  if (adapter.metadata?.id !== appId || typeof adapter.createRenderer !== "function") {
    throw new TypeError(`Renderer adapter '${appId}' has invalid metadata`);
  }
  const renderer = await adapter.createRenderer();
  if (typeof renderer.render !== "function") {
    throw new TypeError(`Renderer adapter '${appId}' did not provide render()`);
  }
  return createRouteController({
    addonCapability: {
      fallback: "not-applicable",
      kind: "not-required",
      path: null,
      required: false,
      supported: true,
    },
    appId,
    document: {
      appId,
      bootstrap: renderer.bootstrap ?? "",
      clientPath: `/__browser/${appId}.js`,
      initialStateSource: "browser-wrapper",
    },
    render(state) {
      return renderer.render(state);
    },
    runtimeId: "node",
    runtimeVersion: runtimeVersion("node"),
    serverId,
    states: TODO_STATE_VARIANTS,
  });
}
