// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { isMainModule, parseServerArgs, runServerMain } from "./lib/cli.mjs";
import { startNodeHttp } from "./lib/node-http-server.mjs";
import { createWebuiRouteController } from "./lib/webui-engine.mjs";

export async function startNodeHttpWebuiServer(options) {
  const controller = await createWebuiRouteController({
    addonPath: options.addonPath,
    responseMode: options.responseMode,
    runtimeId: "node",
    serverId: "node-http",
  });
  return startNodeHttp(controller, options);
}

if (isMainModule(import.meta.url)) {
  await runServerMain({
    appId: "webui",
    argv: process.argv.slice(2),
    runtimeId: "node",
    serverId: "node-http",
    start(argv) {
      return startNodeHttpWebuiServer(parseServerArgs(argv));
    },
  });
}
