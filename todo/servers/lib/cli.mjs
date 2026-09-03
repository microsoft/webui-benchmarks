// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  UNSUPPORTED_EXIT_CODE,
  UnsupportedRuntimeError,
  startupErrorResult,
  unsupportedResult,
} from "./capability.mjs";
import { runtimeVersion as readRuntimeVersion } from "./runtime.mjs";

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(`Invalid port '${value}'`);
  }
  return port;
}

export function parseServerArgs(
  argv,
  { allowApp = false, defaultApp = "webui" } = {},
) {
  const options = {
    addonPath: process.env.WEBUI_ADDON_PATH,
    appId: defaultApp,
    host: process.env.WEBUI_BENCH_HOST ?? "127.0.0.1",
    port: parsePort(
      process.env.WEBUI_BENCH_PORT ?? process.env.PORT ?? "3000",
    ),
    protocolPath: process.env.WEBUI_BENCH_PROTOCOL,
    responseMode: process.env.WEBUI_BENCH_RESPONSE_MODE ?? "progressive",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === "--host") {
      options.host = value;
    } else if (argument === "--port") {
      options.port = parsePort(value);
    } else if (argument === "--addon") {
      options.addonPath = value;
    } else if (argument === "--response-mode") {
      options.responseMode = value;
    } else if (argument === "--protocol") {
      options.protocolPath = value;
    } else if (argument === "--app" && allowApp) {
      options.appId = value;
    } else {
      throw new Error(`Unknown option '${argument}'`);
    }
  }
  if (!["complete", "progressive"].includes(options.responseMode)) {
    throw new RangeError(
      `--response-mode must be 'complete' or 'progressive', received '${options.responseMode}'`,
    );
  }
  return Object.freeze(options);
}

export function isMainModule(moduleUrl, argv = process.argv) {
  return (
    typeof argv[1] === "string"
    && pathToFileURL(resolve(argv[1])).href === moduleUrl
  );
}

export async function runServerMain({
  appId,
  argv,
  runtimeId,
  serverId,
  start,
}) {
  const runtimeVersion = readRuntimeVersion(runtimeId);
  try {
    const server = await start(argv);
    process.stdout.write(`${JSON.stringify(server.announcement)}\n`);
    let closing = false;
    const close = async () => {
      if (closing) {
        return;
      }
      closing = true;
      await server.close();
    };
    process.once("SIGINT", () => {
      void close();
    });
    process.once("SIGTERM", () => {
      void close();
    });
  } catch (error) {
    if (error instanceof UnsupportedRuntimeError) {
      const result = unsupportedResult({
        appId,
        error,
        runtimeId,
        runtimeVersion,
        serverId,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.stderr.write(`${error.message}\nhelp: ${error.help}\n`);
      process.exitCode = UNSUPPORTED_EXIT_CODE;
      return;
    }
    const result = startupErrorResult({
      appId,
      error,
      runtimeId,
      runtimeVersion,
      serverId,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`${result.message}\n`);
    process.exitCode = 1;
  }
}

export function serverAnnouncement(controller, host, port) {
  return Object.freeze({
    ...controller.metadata,
    host,
    port,
    url: `http://${host}:${port}`,
  });
}
