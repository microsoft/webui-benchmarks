// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrateTodoApp } from "../../apps/preact/client.jsx";
import {
  benchmarkTarget,
  initialState,
  publishFailure,
  publishReady,
} from "./ready.mjs";

const startedAt = performance.now();
try {
  hydrateTodoApp(benchmarkTarget(), initialState());
  await publishReady({
    clientMode: "hydrate",
    hydrationStatus: "supported",
    startedAt,
  });
} catch (error) {
  publishFailure(error, "hydrate");
  throw error;
}
