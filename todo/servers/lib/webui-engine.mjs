// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { existsSync, realpathSync, readFileSync } from "node:fs";
import process from "node:process";
import { isAbsolute, resolve } from "node:path";
import { TODO_STATE_VARIANTS } from "../../shared/state.mjs";
import { createWebuiRenderState } from "../../shared/webui-state.mjs";
import {
  REPOSITORY_ROOT,
  configuredWebuiCheckout,
} from "../../shared/webui-dependency.mjs";
import { UnsupportedRuntimeError } from "./capability.mjs";
import { createRouteController } from "./contract.mjs";
import { runtimeVersion } from "./runtime.mjs";

// Resolved against the current working directory (every launcher starts
// these servers from the repository root, see servers/README.md) rather than
// import.meta.url: a Bun `--compile` executable embeds this module under a
// virtual `/$bunfs/` root, so a URL relative to the module's own location no
// longer points at a real file on disk.
const defaultProtocolPath = resolve(
  process.cwd(),
  "todo",
  "apps",
  "webui-lightdom",
  "dist",
  "protocol.bin",
);
function runtimeAvailable(runtimeId) {
  if (runtimeId === "bun") {
    return typeof globalThis.Bun !== "undefined";
  }
  return (
    runtimeId === "node"
    && typeof process !== "undefined"
    && process.release?.name === "node"
    && typeof globalThis.Bun === "undefined"
  );
}

function nativeAddonCandidates() {
  const fileName = {
    darwin: "libwebui_node.dylib",
    linux: "libwebui_node.so",
    win32: "webui_node.dll",
  }[process.platform];
  if (!fileName) {
    return [];
  }
  const checkout = configuredWebuiCheckout();
  const candidates = [];
  if (checkout !== null) {
    candidates.push(
      { path: resolve(checkout, "target", "release", fileName), source: "checkout" },
      { path: resolve(checkout, "target", "debug", fileName), source: "checkout" },
    );
  }
  candidates.push(
    {
      path: resolve(REPOSITORY_ROOT, "target", "release", fileName),
      source: "repository",
    },
    {
      path: resolve(REPOSITORY_ROOT, "target", "debug", fileName),
      source: "repository",
    },
  );
  return candidates;
}

function checkedAddonPath(candidate, source) {
  const absolutePath = isAbsolute(candidate)
    ? candidate
    : resolve(process.cwd(), candidate);
  if (!existsSync(absolutePath)) {
    throw new UnsupportedRuntimeError(
      "native-addon-path-missing",
      `The configured WebUI native addon does not exist: ${absolutePath}`,
      "Build webui-node in release mode or set WEBUI_ADDON_PATH to the shared native addon.",
    );
  }
  return Object.freeze({
    path: realpathSync(absolutePath),
    source,
  });
}

export async function resolveNativeAddon(explicitPath = undefined) {
  const configuredPath = explicitPath ?? process.env.WEBUI_ADDON_PATH;
  if (configuredPath) {
    return checkedAddonPath(configuredPath, "environment");
  }
  for (const candidate of nativeAddonCandidates()) {
    if (existsSync(candidate.path)) {
      return checkedAddonPath(candidate.path, candidate.source);
    }
  }
  try {
    const platform = await import("@microsoft/webui/platform.js");
    const resolvedPath = platform.resolve("addon");
    if (resolvedPath) {
      return checkedAddonPath(resolvedPath, "package");
    }
  } catch (cause) {
    throw new UnsupportedRuntimeError(
      "native-addon-resolution-failed",
      "The WebUI native addon could not be resolved.",
      "Install the released @microsoft/webui package, build the configured checkout, or set WEBUI_ADDON_PATH.",
      { cause },
    );
  }
  throw new UnsupportedRuntimeError(
    "native-addon-unavailable",
    `No WebUI native addon is available for ${process.platform}-${process.arch}.`,
    "Build the configured WebUI checkout or install the matching @microsoft/webui platform package.",
  );
}

function assertRuntime(runtimeId) {
  if (!runtimeAvailable(runtimeId)) {
    throw new UnsupportedRuntimeError(
      "runtime-unavailable",
      `This server requires the ${runtimeId} runtime.`,
      `Launch this entry point with ${runtimeId}, not another JavaScript runtime.`,
    );
  }
}

function nativeLoadError(runtimeId, addonPath, cause) {
  return new UnsupportedRuntimeError(
    "native-addon-load-failed",
    `${runtimeId} could not load the WebUI native addon at ${addonPath}.`,
    "Use the pinned runtime and rebuild webui-node for that runtime's Node-API ABI. WASM fallback is intentionally disabled.",
    { cause },
  );
}

function streamWebuiResponse(protocol, state, requestPath) {
  const session = protocol.streamResponse({ requestPath });
  let started = false;
  let step;
  return new ReadableStream({
    pull(controller) {
      try {
        do {
          if (!started) {
            started = true;
            step = session.start(state);
          } else if (step.boundary !== undefined) {
            step = session.resume(step.boundary.instanceId, {}, "final");
          } else {
            step = session.advance();
          }
          if (step.bytes.byteLength > 0) {
            controller.enqueue(step.bytes);
            if (step.done) controller.close();
            return;
          }
        } while (!step.done);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function createWebuiRouteController({
  addonPath = undefined,
  protocolPath = defaultProtocolPath,
  responseMode = "progressive",
  runtimeId,
  serverId,
}) {
  assertRuntime(runtimeId);
  const addon = await resolveNativeAddon(addonPath);
  process.env.WEBUI_ADDON_PATH = addon.path;
  const resolvedProtocolPath = resolve(protocolPath);
  if (!existsSync(resolvedProtocolPath)) {
    throw new Error(
      `Missing ${resolvedProtocolPath}. Build the controlled WebUI renderer before starting the server.`,
    );
  }

  let Protocol;
  try {
    ({ Protocol } = await import("@microsoft/webui"));
  } catch (cause) {
    throw nativeLoadError(runtimeId, addon.path, cause);
  }
  if (typeof Protocol !== "function") {
    throw nativeLoadError(
      runtimeId,
      addon.path,
      new TypeError("@microsoft/webui did not export Protocol"),
    );
  }

  let protocol;
  try {
    protocol = new Protocol(readFileSync(resolvedProtocolPath), { plugin: "webui" });
    if (typeof protocol.render !== "function") {
      throw new TypeError(
        `The native addon must provide render(); observed ${typeof protocol.render}`,
      );
    }
  } catch (cause) {
    throw nativeLoadError(runtimeId, addon.path, cause);
  }

  return createRouteController({
    addonCapability: {
      fallback: "disabled",
      kind: "node-api-native",
      path: addon.path,
      required: true,
      source: addon.source,
      supported: true,
    },
    appId: "webui",
    render(state, requestPath) {
      return protocol.render(createWebuiRenderState(state), { requestPath });
    },
    renderStream(state, requestPath) {
      return streamWebuiResponse(
        protocol,
        createWebuiRenderState(state),
        requestPath,
      );
    },
    renderPartial(state, requestPath, inventoryHex) {
      return protocol.renderPartial(
        createWebuiRenderState(state),
        "index.html",
        requestPath,
        inventoryHex,
      );
    },
    responseMode,
    runtimeId,
    runtimeVersion: runtimeVersion(runtimeId),
    serverId,
    states: TODO_STATE_VARIANTS,
    streaming: "progressive-boundaries",
  });
}

export const WEBUI_PROTOCOL_PATH = defaultProtocolPath;
