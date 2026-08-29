// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Container health probe. The demo image ships no shell utilities beyond Node,
 * so readiness is checked with the runtime that is already present.
 */

import process from "node:process";
import { READY_PATH } from "./routing.mjs";

const port = process.env.PORT ?? process.env.WEBUI_DEMO_PORT ?? "8080";

try {
  const response = await fetch(`http://127.0.0.1:${port}${READY_PATH}`, {
    signal: AbortSignal.timeout(4_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
