// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createServer } from "node:http";
import { createRequestDispatcher, internalErrorResponse } from "./dispatch.mjs";
import { serverAnnouncement } from "./cli.mjs";

function writeResponse(response, result) {
  response.writeHead(result.status, result.headers);
  response.end(result.headOnly ? undefined : result.body);
}

export async function startNodeHttp(controller, { host, port }) {
  const dispatch = createRequestDispatcher(controller);
  const server = createServer((request, response) => {
    void dispatch(request.url ?? "/", request.method, request.headers).then(
      (result) => writeResponse(response, result),
      (error) => writeResponse(response, internalErrorResponse(error)),
    );
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
