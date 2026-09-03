// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { isMainModule } from "../servers/lib/cli.mjs";

const builders = Object.freeze({
  lit: () => import("../apps/lit/build.mjs"),
  preact: () => import("../apps/preact/build.mjs"),
  react: () => import("../apps/react/build.mjs"),
  "react-tanstack": () => import("../apps/react-tanstack/build.mjs"),
  solid: () => import("../apps/solid/build.mjs"),
  vue: () => import("../apps/vue/build.mjs"),
  webui: () => import("../apps/webui-lightdom/build.mjs"),
  "webui-fast": () => import("../apps/webui-fast/build.mjs"),
  "webui-shadowdom": () => import("../apps/webui-shadowdom/build.mjs"),
});

export async function buildRenderer(appId) {
  const load = builders[appId];
  if (load === undefined) {
    throw new RangeError(
      `Unknown renderer '${appId}'. Expected: ${Object.keys(builders).join(", ")}`,
    );
  }
  const builder = await load();
  if (typeof builder.build !== "function") {
    throw new TypeError(`${appId} does not export build()`);
  }
  return builder.build();
}

if (isMainModule(import.meta.url)) {
  const appId = process.argv[2];
  if (appId === undefined || process.argv.length !== 3) {
    throw new Error(
      "Usage: node build-renderer.mjs <lit|preact|react|react-tanstack|solid|vue|webui|webui-fast|webui-shadowdom>",
    );
  }
  await buildRenderer(appId);
}
