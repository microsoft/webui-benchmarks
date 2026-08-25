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

export async function startDenoWebuiServer(options) {
  const controller = await createWebuiRouteController({
    addonPath: options.addonPath,
    runtimeId: "deno",
    serverId: "deno-serve",
  });
  const dispatch = createRequestDispatcher(controller);
  const abortController = new AbortController();
  const server = Deno.serve(
    {
      hostname: options.host,
      onListen() {},
      port: options.port,
      signal: abortController.signal,
    },
    async (request) => {
      try {
        return toFetchResponse(await dispatch(request.url, request.method));
      } catch (error) {
        return toFetchResponse(internalErrorResponse(error));
      }
    },
  );
  return Object.freeze({
    announcement: serverAnnouncement(
      controller,
      options.host,
      server.addr.port,
    ),
    async close() {
      abortController.abort();
      await server.finished;
    },
  });
}

if (import.meta.main || isMainModule(import.meta.url)) {
  const args = typeof Deno !== "undefined"
    ? Deno.args
    : process.argv.slice(2);
  await runServerMain({
    appId: "webui",
    argv: args,
    runtimeId: "deno",
    serverId: "deno-serve",
    start(argv) {
      return startDenoWebuiServer(parseServerArgs(argv));
    },
  });
}
