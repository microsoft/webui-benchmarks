// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildClient } from "../browser/build-clients.mjs";
import { TODO_ROOT } from "../runner/lib/paths.mjs";
import { launchCaseServer } from "../runner/lib/server.mjs";
import { ENTRY_ROUTE } from "./routing.mjs";

/**
 * Applications whose browser client bundle is produced by this repository
 * rather than by a framework production build. The two WebUI entries are built
 * because the Rust server serves their emitted `dist/browser` directory; the
 * remaining entries are served by the gateway itself, because the shared
 * `node:http` renderer transport intentionally publishes documents only.
 */
const CLIENT_APPS = Object.freeze([
  "lit",
  "preact",
  "react",
  "react-tanstack",
  "solid",
  "vue",
  "webui",
  "webui-fast",
]);
const GATEWAY_SERVED_APPS = Object.freeze(
  new Set(["lit", "preact", "react", "react-tanstack", "solid", "vue"]),
);
const CLIENT_APP_SET = new Set(CLIENT_APPS);
const SHARED_STYLES = resolve(TODO_ROOT, "shared", "styles.css");
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const EMPTY_CLIENT = Object.freeze({
  assetDirectory: undefined,
  assets: new Map(),
});

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

async function buildDemoClient(appId, progress = () => {}) {
  if (!CLIENT_APP_SET.has(appId)) {
    return EMPTY_CLIENT;
  }
  progress(`Building the ${appId} browser client`);
  const [bundle, styles] = await Promise.all([
    buildClient(appId),
    GATEWAY_SERVED_APPS.has(appId) ? readFile(SHARED_STYLES) : undefined,
  ]);
  return Object.freeze({
    assetDirectory: bundle.browserAssetDirectory,
    assets: GATEWAY_SERVED_APPS.has(appId)
      ? assetTable(appId, bundle, styles)
      : new Map(),
  });
}

/**
 * Build every browser client the demo needs once, and index the static assets
 * each hosted application expects the origin to publish.
 */
export async function buildDemoClients({
  appIds = CLIENT_APPS,
  progress = () => {},
} = {}) {
  const assetsByApp = new Map();
  const assetDirectories = new Map();
  for (const appId of appIds) {
    const client = await buildDemoClient(appId, progress);
    if (typeof client.assetDirectory === "string") {
      assetDirectories.set(appId, client.assetDirectory);
    }
    if (GATEWAY_SERVED_APPS.has(appId)) {
      assetsByApp.set(appId, client.assets);
    }
  }
  return Object.freeze({ assetDirectories, assetsByApp });
}

async function launchProduct(product, client, registry, timeoutMilliseconds) {
  const server = await launchCaseServer(product.sourceCase, {
    browserAssetDirectory: client.assetDirectory,
    browserTls: false,
    registry,
    timeoutMilliseconds,
  });
  return Object.freeze({
    assets: client.assets,
    origin: server.announcement.url,
    product,
    stop: () => server.stop(),
  });
}

async function warmProduct(
  entry,
  requests = 3,
  timeoutMilliseconds = 180_000,
) {
  for (let request = 0; request < requests; request += 1) {
    const response = await fetch(`${entry.origin}${ENTRY_ROUTE}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    await response.arrayBuffer();
    if (response.status !== 200) {
      throw new Error(
        `${entry.product.id} warmup returned HTTP ${response.status}`,
      );
    }
    if (response.headers.has("location")) {
      throw new Error(`${entry.product.id} warmup redirected`);
    }
  }
}

function createScheduler(concurrency) {
  const limit = Math.max(1, concurrency);
  const pending = [];
  let active = 0;
  let closed = false;

  const pump = () => {
    while (!closed && active < limit && pending.length > 0) {
      const job = pending.shift();
      active += 1;
      Promise.resolve()
        .then(job.operation)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return Object.freeze({
    close(error = new Error("Demo host is shutting down")) {
      closed = true;
      for (const job of pending.splice(0)) {
        job.reject(error);
      }
    },
    schedule(operation) {
      if (closed) {
        return Promise.reject(new Error("Demo host is shutting down"));
      }
      return new Promise((resolveJob, rejectJob) => {
        pending.push({ operation, reject: rejectJob, resolve: resolveJob });
        pump();
      });
    },
  });
}

/**
 * Lazily build and launch products when a browsing session first selects them.
 * Concurrent requests for the same product share one launch, and separate
 * product launches remain bounded to protect small container instances.
 */
export function createDemoHost({
  concurrency = 4,
  progress = () => {},
  registry,
  timeoutMilliseconds = 180_000,
  buildClientForApp = buildDemoClient,
  launch = launchProduct,
  warm = warmProduct,
}) {
  const hosted = new Map();
  const launching = new Map();
  const clients = new Map();
  const scheduler = createScheduler(concurrency);
  let ready = false;
  let stopping = false;

  const clientFor = (appId) => {
    let pending = clients.get(appId);
    if (pending === undefined) {
      pending = Promise.resolve(buildClientForApp(appId, progress));
      clients.set(appId, pending);
      pending.catch(() => clients.delete(appId));
    }
    return pending;
  };

  const ensureHosted = (product) => {
    const existing = hosted.get(product.id);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    if (stopping) {
      return Promise.reject(new Error("Demo host is shutting down"));
    }
    let pending = launching.get(product.id);
    if (pending !== undefined) {
      return pending;
    }
    pending = scheduler.schedule(async () => {
      const client = await clientFor(product.appId);
      const entry = await launch(product, client, registry, timeoutMilliseconds);
      hosted.set(product.id, entry);
      progress(
        `${entry.product.id.padEnd(42)} ${entry.origin} (${entry.product.streaming})`,
      );
      return entry;
    });
    launching.set(product.id, pending);
    pending.finally(() => launching.delete(product.id)).catch(() => {});
    return pending;
  };

  const stopAll = async () => {
    stopping = true;
    ready = false;
    scheduler.close();
    await Promise.allSettled([...launching.values()]);
    await Promise.allSettled([...hosted.values()].map((entry) => entry.stop()));
    hosted.clear();
  };

  const prepareAll = async (products, warmupRequests = 3) => {
    await Promise.all(
      products.map(async (product) => {
        const entry = await ensureHosted(product);
        await scheduler.schedule(
          () => warm(entry, warmupRequests, timeoutMilliseconds),
        );
        progress(`${entry.product.id.padEnd(42)} warmed`);
      }),
    );
    ready = true;
  };

  return Object.freeze({
    ensureHosted,
    hosted,
    isReady: () => ready,
    launching,
    prepareAll,
    stopAll,
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
        batch.map((product) => {
          const client = {
            assetDirectory: clients.assetDirectories.get(product.appId),
            assets: clients.assetsByApp.get(product.appId) ?? new Map(),
          };
          return launchProduct(product, client, registry, timeoutMilliseconds);
        }),
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
