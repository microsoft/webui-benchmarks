// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { CACHE_MODE, SERVER_SCHEMA, STATE_VARIANT_COUNT } from "./contract.mjs";

export const UNSUPPORTED_EXIT_CODE = 78;

export class UnsupportedRuntimeError extends Error {
  constructor(code, message, help, options = undefined) {
    super(message, options);
    this.name = "UnsupportedRuntimeError";
    this.code = code;
    this.help = help;
  }
}

export function unsupportedResult({
  appId,
  error,
  runtimeId,
  runtimeVersion,
  serverId,
}) {
  return Object.freeze({
    addonCapability: Object.freeze({
      code: error.code,
      fallback: "disabled",
      help: error.help,
      kind: "node-api-native",
      message: error.message,
      required: true,
      supported: false,
    }),
    appId,
    cacheMode: CACHE_MODE,
    responseBytes: null,
    runtimeId,
    runtimeVersion,
    schema: SERVER_SCHEMA,
    serverId,
    stateVariantCount: STATE_VARIANT_COUNT,
    status: "unsupported",
  });
}

export function startupErrorResult({
  appId,
  error,
  runtimeId,
  runtimeVersion,
  serverId,
}) {
  return Object.freeze({
    appId,
    cacheMode: CACHE_MODE,
    code: "server-startup-failed",
    message: error instanceof Error ? error.message : String(error),
    responseBytes: null,
    runtimeId,
    runtimeVersion,
    schema: SERVER_SCHEMA,
    serverId,
    stateVariantCount: STATE_VARIANT_COUNT,
    status: "error",
  });
}
