// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequestDispatcher, internalErrorResponse } from "./dispatch.mjs";
import { serverAnnouncement } from "./cli.mjs";

async function writeResponse(response, result) {
  response.writeHead(result.status, result.headers);
  if (result.headOnly) {
    if (result.body instanceof ReadableStream) {
      await result.body.cancel(
        new Error("HEAD requests do not consume renderer streams"),
      );
    }
    response.end();
    return;
  }
  if (!(result.body instanceof ReadableStream)) {
    response.end(result.headOnly ? undefined : result.body);
    return;
  }
  await pipeline(Readable.fromWeb(result.body), response);
}

export async function startNodeHttp(controller, { host, port }) {
  const dispatch = createRequestDispatcher(controller);
  const server = createServer((request, response) => {
    void (async () => {
      const abort = new AbortController();
      let completed = false;
      const onClose = () => {
        if (!completed && !response.writableEnded) {
          abort.abort(new Error("node:http response closed before rendering"));
        }
      };
      response.once("close", onClose);
      try {
        const result = await dispatch(
          request.url ?? "/",
          request.method,
          request.headers,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) {
          if (result.body instanceof ReadableStream) {
            await result.body.cancel(abort.signal.reason);
          }
          return;
        }
        await writeResponse(response, result);
        completed = true;
      } catch (error) {
        if (response.destroyed) {
          return;
        }
        if (response.headersSent) {
          response.destroy(error);
        } else {
          await writeResponse(response, internalErrorResponse(error));
        }
      } finally {
        response.off("close", onClose);
      }
    })();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("node:http did not expose a TCP benchmark address");
  }
  return Object.freeze({
    announcement: serverAnnouncement(controller, host, address.port),
    async close() {
      if (!server.listening) {
        return;
      }
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  });
}
