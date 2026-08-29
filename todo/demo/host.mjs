// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildClient } from "../browser/build-clients.mjs";
import { TODO_ROOT } from "../runner/lib/paths.mjs";
import { launchCaseServer } from "../runner/lib/server.mjs";

/**
 * Applications whose browser client bundle is produced by this repository
 * rather than by a framework production build. The two WebUI entries are built
 * because the Rust server serves their emitted `dist/browser` directory; the
 * remaining entries are served by the gateway itself, because the shared
 * `node:http` renderer transport intentionally publishes documents only.
 */
const CLIENT_APPS = Object.freeze([
  "preact",
  "react",
  "react-tanstack",
  "solid",
  "vue",
  "webui",
  "webui-fast",
]);
const GATEWAY_SERVED_APPS = Object.freeze(
  new Set(["preact", "react", "react-tanstack", "solid", "vue"]),
);
const SHARED_STYLES = resolve(TODO_ROOT, "shared", "styles.css");
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

function contentType(path) {
  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (path.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/javascript; charset=utf-8";
}

function assetTable(appId, bundle, styles) {
  const assets = new Map([
    [`/__browser/${appId}.js`, bundle],
    ["/__browser/styles.css", styles],
  ]);
  for (const [path, contents] of bundle.additionalAssets ?? []) {
    assets.set(path, contents);
  }
  return Object.freeze(
    new Map(
      [...assets].map(([path, body]) =>
        [
          path,
          Object.freeze({
            body,
            cacheControl: IMMUTABLE_CACHE_CONTROL,
            contentType: contentType(path),
          }),
        ]
      ),
    ),
  );
}

/**
 * Build every browser client the demo needs once, and index the static assets
 * each hosted application expects the origin to publish.
 */
export async function buildDemoClients({
  appIds = CLIENT_APPS,
  progress = () => {},
} = {}) {
  const styles = await readFile(SHARED_STYLES);
  const assetsByApp = new Map();
  const assetDirectories = new Map();
  for (const appId of appIds) {
    progress(`Building the ${appId} browser client`);
    const bundle = await buildClient(appId);
    if (typeof bundle.browserAssetDirectory === "string") {
      assetDirectories.set(appId, bundle.browserAssetDirectory);
    }
    if (GATEWAY_SERVED_APPS.has(appId)) {
      assetsByApp.set(appId, assetTable(appId, bundle, styles));
    }
  }
  return Object.freeze({ assetDirectories, assetsByApp });
}

async function launchProduct(product, clients, registry, timeoutMilliseconds) {
  const server = await launchCaseServer(product.sourceCase, {
    browserAssetDirectory: clients.assetDirectories.get(product.appId),
    browserTls: false,
    registry,
    timeoutMilliseconds,
  });
  return Object.freeze({
    assets: clients.assetsByApp.get(product.appId) ?? new Map(),
    origin: server.announcement.url,
    product,
    stop: () => server.stop(),
  });
}

/**
 * Launch every demo product in bounded batches. A single container starts 24
 * production servers, so the batches keep startup from saturating the CPU (and
 * therefore from tripping each server's readiness timeout) while still
 * overlapping the slow framework boots.
 */
export async function launchDemoProducts({
  clients,
  concurrency = 4,
  products,
  progress = () => {},
  registry,
  timeoutMilliseconds = 180_000,
}) {
  const hosted = new Map();
  const pending = [...products];
  const stopAll = async () => {
    await Promise.allSettled([...hosted.values()].map((entry) => entry.stop()));
    hosted.clear();
  };
  try {
    while (pending.length > 0) {
      const batch = pending.splice(0, Math.max(1, concurrency));
      const launched = await Promise.all(
        batch.map((product) =>
          launchProduct(product, clients, registry, timeoutMilliseconds)
        ),
      );
      for (const entry of launched) {
        hosted.set(entry.product.id, entry);
        progress(
          `${entry.product.id.padEnd(42)} ${entry.origin} (${entry.product.streaming})`,
        );
      }
    }
  } catch (error) {
    await stopAll();
    throw error;
  }
  return Object.freeze({ hosted, stopAll });
}

export { CLIENT_APPS, GATEWAY_SERVED_APPS };
