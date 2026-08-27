// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { defineEventHandler, setResponseHeader } from "h3";
import { nextDynamicTodoState } from "../../lib/server-state.mjs";

export default defineEventHandler((event) => {
  setResponseHeader(
    event,
    "cache-control",
    "no-store, no-cache, must-revalidate",
  );
  return nextDynamicTodoState();
});
