// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import {
  isMainModule,
  parseServerArgs,
  runServerMain,
  serverAnnouncement,
} from "./lib/cli.mjs";
import { createRequestDispatcher, internalErrorResponse } from "./lib/dispatch.mjs";
import { toFetchResponse } from "./lib/fetch-response.mjs";
import { createWebuiRouteController } from "./lib/webui-engine.mjs";

export async function startBunWebuiServer(options) {
  const controller = await createWebuiRouteController({
    addonPath: options.addonPath,
    protocolPath: options.protocolPath,
    responseMode: options.responseMode,
    runtimeId: "bun",
    serverId: "bun-serve",
  });
  const dispatch = createRequestDispatcher(controller);
  const server = Bun.serve({
    fetch: async (request) => {
      try {
        return toFetchResponse(
          await dispatch(
            request.url,
            request.method,
            request.headers,
            { signal: request.signal },
          ),
        );
      } catch (error) {
        return toFetchResponse(internalErrorResponse(error));
      }
    },
    hostname: options.host,
    port: options.port,
  });
  return Object.freeze({
    announcement: serverAnnouncement(controller, options.host, server.port),
    async close() {
      await server.stop(true);
    },
  });
}

if (import.meta.main || isMainModule(import.meta.url)) {
  await runServerMain({
    appId: "webui",
    argv: process.argv.slice(2),
    runtimeId: "bun",
    serverId: "bun-serve",
    start(argv) {
      return startBunWebuiServer(parseServerArgs(argv));
    },
  });
}
