// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createSecureServer } from "node:http2";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
  currentRequestTimestamp,
} from "../shared/state.mjs";
import { controlledDocument } from "../shared/document.mjs";
import { browserTlsMaterial } from "./tls.mjs";

export { controlledDocument } from "../shared/document.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const stylesPath = resolve(here, "..", "shared", "styles.css");

function send(response, status, contentType, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(bytes.byteLength),
    "content-type": contentType,
    ...headers,
  });
  response.end(bytes);
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolveClose();
      }
    });
    server.closeAllConnections?.();
  });
}

export async function startControlledBrowserServer({
  backend,
  browserCase,
  clientBundle,
  serverRenderer,
}) {
  if (!Buffer.isBuffer(clientBundle)) {
    throw new TypeError(`${browserCase.appId} requires a browser client bundle`);
  }
  if (backend === undefined && serverRenderer === undefined) {
    throw new TypeError("A controlled browser server requires an SSR source");
  }
  const styles = await readFile(stylesPath);
  const tls = await browserTlsMaterial();
  const clientPath = `/__browser/${browserCase.appId}.js`;
  const localSourcePath = "/__browser/source/dynamic";
  let nextVariant = 0;
  let serverUrl;
  const server = createSecureServer(
    {
      allowHTTP1: false,
      cert: tls.cert,
      key: tls.key,
    },
    async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === clientPath) {
        send(
          response,
          200,
          "text/javascript; charset=utf-8",
          clientBundle,
          { "cache-control": "public, max-age=31536000, immutable" },
        );
        return;
      }
      const additionalAsset = clientBundle.additionalAssets?.get(url.pathname);
      if (additionalAsset !== undefined) {
        send(
          response,
          200,
          url.pathname.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
          additionalAsset,
          { "cache-control": "public, max-age=31536000, immutable" },
        );
        return;
      }
      if (url.pathname === "/__browser/styles.css") {
        send(
          response,
          200,
          "text/css; charset=utf-8",
          styles,
          { "cache-control": "public, max-age=31536000, immutable" },
        );
        return;
      }
      if (url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      if (
        url.pathname === localSourcePath
        && serverRenderer !== undefined
      ) {
        const variantIndex = nextVariant;
        nextVariant = (nextVariant + 1) % TODO_STATE_VARIANTS.length;
        const requestTimestamp = currentRequestTimestamp();
        const fragment = String(
          await serverRenderer.render(
            createRequestTodoState(
              TODO_STATE_VARIANTS[variantIndex],
              requestTimestamp,
            ),
          ),
        );
        send(response, 200, "text/html; charset=utf-8", fragment, {
          "x-webui-bench-timestamp": requestTimestamp,
          "x-webui-bench-variant": String(variantIndex),
          },
        );
        return;
      }
      if (url.pathname !== "/dynamic") {
        send(response, 404, "text/plain; charset=utf-8", "Not found");
        return;
      }
      const adapterStartedAt = performance.now();
      const backendStartedAt = performance.now();
      let backendBodyAt;
      let backendHeadersAt;
      let backendServerTiming = null;
      let fragment;
      let requestTimestamp;
      let variantIndex;
      if (serverRenderer !== undefined) {
        variantIndex = nextVariant;
        nextVariant = (nextVariant + 1) % TODO_STATE_VARIANTS.length;
        requestTimestamp = currentRequestTimestamp();
        fragment = String(
          await serverRenderer.render(
            createRequestTodoState(
              TODO_STATE_VARIANTS[variantIndex],
              requestTimestamp,
            ),
          ),
        );
        backendHeadersAt = performance.now();
        backendBodyAt = backendHeadersAt;
      } else {
        const sourceUrl =
          `${backend.announcement.url}${backend.announcement.routes.dynamic}`;
        const source = await fetch(sourceUrl, {
          headers: {
            "accept-encoding": "identity",
            "x-webui-browser-profile": "1",
          },
          signal: AbortSignal.timeout(30_000),
        });
        backendHeadersAt = performance.now();
        if (!source.ok) {
          throw new Error(`Controlled source returned HTTP ${source.status}`);
        }
        fragment = String(await source.text());
        backendBodyAt = performance.now();
        requestTimestamp = source.headers.get("x-webui-bench-timestamp");
        if (requestTimestamp === null) {
          throw new Error("Controlled source omitted its request timestamp");
        }
        variantIndex = Number(
          source.headers.get("x-webui-bench-variant"),
        );
        backendServerTiming = source.headers.get("server-timing");
      }
      if (
        !Number.isInteger(variantIndex)
        || variantIndex < 0
        || variantIndex >= TODO_STATE_VARIANTS.length
      ) {
        throw new Error("Controlled source omitted its state variant");
      }
      const document = controlledDocument({
        appId: browserCase.appId,
        bootstrap: serverRenderer?.bootstrap,
        clientPath,
        fragment,
        initialStateSource: browserCase.initialStateSource,
        state: createRequestTodoState(
          TODO_STATE_VARIANTS[variantIndex],
          requestTimestamp,
        ),
      });
      const documentBuiltAt = performance.now();
      const serverTiming = [
        serverRenderer === undefined
          ? `browser-backend-headers;dur=${
            (backendHeadersAt - backendStartedAt).toFixed(3)
          }`
          : `browser-render;dur=${
            (backendHeadersAt - backendStartedAt).toFixed(3)
          }`,
        `browser-backend-body;dur=${
          (backendBodyAt - backendHeadersAt).toFixed(3)
        }`,
        `browser-document;dur=${
          (documentBuiltAt - backendBodyAt).toFixed(3)
        }`,
        `browser-adapter-total;dur=${
          (documentBuiltAt - adapterStartedAt).toFixed(3)
        }`,
        backendServerTiming,
      ].filter(Boolean).join(",");
      send(response, 200, "text/html; charset=utf-8", document, {
        "server-timing": serverTiming,
        "x-webui-browser-source-bytes": String(
          Buffer.byteLength(fragment, "utf8"),
        ),
        "x-webui-bench-timestamp": requestTimestamp,
        "x-webui-browser-variant": String(variantIndex),
        ...(serverRenderer === undefined
          ? {}
          : { "x-webui-browser-ssr": "solid-hydratable" }),
      });
    } catch (error) {
      send(
        response,
        500,
        "text/plain; charset=utf-8",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Controlled browser server did not expose a TCP address");
  }
  serverUrl = `https://127.0.0.1:${address.port}`;
  let stopped = false;
  return Object.freeze({
    announcement: Object.freeze({
      appId: browserCase.appId,
      browserSsrBundleBytes: serverRenderer?.bundleBytes,
      runtimeId: "node",
      runtimeVersion: process.versions.node,
      serverId: serverRenderer === undefined
        ? "browser-document-host"
        : `${browserCase.appId}-browser-ssr`,
      workerCount: 1,
    }),
    command: serverRenderer === undefined
      ? "browser document host"
      : `browser-tier ${browserCase.appId} SSR`,
    url: serverUrl,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await closeServer(server);
    },
  });
}
