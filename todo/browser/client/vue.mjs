// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrateTodo } from "../../apps/vue/dist/client.mjs";
import {
  benchmarkTarget,
  initialState,
  publishFailure,
  publishReady,
} from "./ready.mjs";

const startedAt = performance.now();
try {
  await hydrateTodo(benchmarkTarget(), initialState());
  await publishReady({
    clientMode: "hydrate",
    hydrationStatus: "supported",
    startedAt,
  });
} catch (error) {
  publishFailure(error, "hydrate");
  throw error;
}
