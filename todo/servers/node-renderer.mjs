// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { createAdapterRouteController } from "./lib/adapter-engine.mjs";
import { isMainModule, parseServerArgs, runServerMain } from "./lib/cli.mjs";
import { startNodeHttp } from "./lib/node-http-server.mjs";

/**
 * Serves one product SSR renderer that ships no canonical HTTP server through
 * the same minimal `node:http` transport used by the WebUI Node case, so the
 * official matrix compares renderers rather than web frameworks.
 */
export async function startNodeRendererServer(options) {
  const controller = await createAdapterRouteController({
    ...options,
    serverId: "node-http",
  });
  return startNodeHttp(controller, options);
}

if (isMainModule(import.meta.url)) {
  const parsed = parseServerArgs(process.argv.slice(2), {
    allowApp: true,
    defaultApp: process.env.WEBUI_BENCH_APP ?? "webui",
  });
  await runServerMain({
    appId: parsed.appId,
    argv: process.argv.slice(2),
    runtimeId: "node",
    serverId: "node-http",
    start(argv) {
      return startNodeRendererServer(
        parseServerArgs(argv, {
          allowApp: true,
          defaultApp: process.env.WEBUI_BENCH_APP ?? "webui",
        }),
      );
    },
  });
}
