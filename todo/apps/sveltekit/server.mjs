// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createServer } from "node:http";
import process from "node:process";
import { handler } from "./build/handler.js";

const host = process.env.HOST ?? process.env.HOSTNAME ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const server = createServer((request, response) => {
  const path = request.url?.split("?", 1)[0] ?? "/";
  if (path === "/cached" || path === "/cached/") {
    response.setHeader(
      "cache-control",
      "public, max-age=31536000, immutable",
    );
  } else if (path === "/dynamic" || path === "/dynamic/") {
    response.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  }
  handler(request, response);
});

server.listen(port, host);
