// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createSecureServer } from "node:http2";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
  currentRequestTimestamp,
} from "../shared/state.mjs";
import {
  controlledDocument,
  controlledDocumentStream,
  controlledDocumentWrapperBytes,
} from "../shared/document.mjs";
import { browserTlsMaterial } from "./tls.mjs";

export {
  controlledDocument,
  controlledDocumentStream,
} from "../shared/document.mjs";

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

async function sendStream(
  response,
  status,
  contentType,
  stream,
  headers = {},
  headOnly = false,
) {
  let completed = false;
  let closed = false;
  let markClosed;
  const closedSignal = new Promise((resolve) => {
    markClosed = resolve;
  });
  const onClose = () => {
    closed = true;
    markClosed();
  };
  response.once("close", onClose);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentType,
    ...headers,
  });
  const reader = stream.getReader();
  try {
    if (headOnly) {
      await reader.cancel(
        new Error("HEAD requests do not consume renderer streams"),
      );
      completed = true;
      response.end();
      return;
    }
    while (true) {
      const read = await Promise.race([
        reader.read().then((result) => ({ result })),
        closedSignal.then(() => ({ closed: true })),
      ]);
      if (read.closed || closed) {
        throw new Error("HTTP/2 response closed before the stream completed");
      }
      const { result } = read;
      if (result.done) break;
      if (!response.write(result.value)) {
        const drained = await Promise.race([
          once(response, "drain").then(() => true),
          closedSignal.then(() => false),
        ]);
        if (!drained) {
          throw new Error("HTTP/2 response closed during backpressure");
        }
      }
    }
    completed = true;
    response.end();
  } finally {
    response.off("close", onClose);
    if (!completed) {
      await reader.cancel(
        new Error("HTTP/2 response transmission did not complete"),
      );
    }
    reader.releaseLock();
  }
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
  const applicationPaths = new Set(["/dynamic", "/activity", "/settings"]);
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
            "/dynamic",
          ),
        );
        send(response, 200, "text/html; charset=utf-8", fragment, {
          "x-webui-bench-timestamp": requestTimestamp,
          "x-webui-bench-variant": String(variantIndex),
          },
        );
        return;
      }
      if (!applicationPaths.has(url.pathname)) {
        send(response, 404, "text/plain; charset=utf-8", "Not found");
        return;
      }
      const disconnect = new AbortController();
      response.once("close", () => {
        if (!response.writableEnded) {
          disconnect.abort(
            new Error("Controlled browser response closed before rendering"),
          );
        }
      });
      const acceptsPartial = (request.headers.accept ?? "")
        .split(",")
        .some((value) =>
          value.trim().startsWith("application/json")
          || value.trim().startsWith("application/x-ndjson")
        );
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
        const requestState = createRequestTodoState(
          TODO_STATE_VARIANTS[variantIndex],
          requestTimestamp,
        );
        if (typeof serverRenderer.renderStream === "function") {
          const fragment = await serverRenderer.renderStream(
            requestState,
            url.pathname,
            { signal: disconnect.signal },
          );
          if (disconnect.signal.aborted) {
            await fragment.cancel(disconnect.signal.reason);
            return;
          }
          const documentOptions = {
                appId: browserCase.appId,
                bootstrap: serverRenderer.bootstrap,
                clientPath,
                initialStateSource: browserCase.initialStateSource,
                state: requestState,
              };
          const wrapperBytes = serverRenderer.ownsDocument
            ? 0
            : controlledDocumentWrapperBytes(documentOptions);
          const document = serverRenderer.ownsDocument
            ? fragment
            : controlledDocumentStream({
                ...documentOptions,
                fragment,
              });
          backendHeadersAt = performance.now();
          backendBodyAt = backendHeadersAt;
          await sendStream(
            response,
            200,
            "text/html; charset=utf-8",
            document,
            {
              "server-timing": `browser-stream-setup;dur=${
                (backendHeadersAt - backendStartedAt).toFixed(3)
              }`,
              "x-webui-bench-timestamp": requestTimestamp,
              "x-webui-browser-wrapper-bytes": String(wrapperBytes),
              "x-webui-browser-variant": String(variantIndex),
              "x-webui-browser-ssr": "native-stream",
            },
            request.method === "HEAD",
          );
          return;
        }
        fragment = String(
          await serverRenderer.render(
            requestState,
            url.pathname,
          ),
        );
        backendHeadersAt = performance.now();
        backendBodyAt = backendHeadersAt;
      } else {
        const sourceUrl = `${backend.announcement.url}${url.pathname}`;
        const source = await fetch(sourceUrl, {
          headers: {
            "accept-encoding": "identity",
            ...(acceptsPartial
              ? {
                  accept: "application/json",
                  "x-webui-inventory":
                    request.headers["x-webui-inventory"] ?? "",
                }
              : {}),
            "x-webui-browser-profile": "1",
          },
          signal: AbortSignal.any([
            disconnect.signal,
            AbortSignal.timeout(30_000),
          ]),
        });
        backendHeadersAt = performance.now();
        if (!source.ok) {
          throw new Error(`Controlled source returned HTTP ${source.status}`);
        }
        requestTimestamp = source.headers.get("x-webui-bench-timestamp");
        if (requestTimestamp === null) {
          throw new Error("Controlled source omitted its request timestamp");
        }
        variantIndex = Number(
          source.headers.get("x-webui-bench-variant"),
        );
        backendServerTiming = source.headers.get("server-timing");
        if (
          !acceptsPartial
          && browserCase.initialStateSource === "ssr-document"
          && source.body !== null
        ) {
          await sendStream(
            response,
            200,
            "text/html; charset=utf-8",
            source.body,
            {
              ...(backendServerTiming === null
                ? {}
                : { "server-timing": backendServerTiming }),
              "x-webui-bench-timestamp": requestTimestamp,
              "x-webui-browser-wrapper-bytes": "0",
              "x-webui-browser-variant": String(variantIndex),
            },
            request.method === "HEAD",
          );
          return;
        }
        fragment = String(await source.text());
        backendBodyAt = performance.now();
        if (acceptsPartial) {
          send(response, 200, "application/json; charset=utf-8", fragment, {
            "x-webui-bench-timestamp": requestTimestamp,
            "x-webui-bench-variant": String(variantIndex),
          });
          return;
        }
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
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
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
      streaming: typeof serverRenderer?.renderStream === "function"
        ? "native"
        : "buffered",
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
