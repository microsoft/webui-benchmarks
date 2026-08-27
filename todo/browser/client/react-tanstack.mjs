// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrateTodoApp } from "../../apps/react-tanstack/client.jsx";
import {
  benchmarkTarget,
  initialState,
  publishFailure,
  publishReady,
} from "./ready.mjs";

const startedAt = performance.now();
try {
  const recoverableErrors = [];
  await hydrateTodoApp(benchmarkTarget(), initialState(), {
    onRecoverableError(error) {
      recoverableErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    },
  });
  await publishReady({
    clientMode: "hydrate",
    hydrationResult: () => ({
      reason: recoverableErrors.join("; "),
      status: recoverableErrors.length === 0
        ? "supported"
        : "unsupported",
    }),
    startedAt,
  });
} catch (error) {
  publishFailure(error, "hydrate");
  throw error;
}
