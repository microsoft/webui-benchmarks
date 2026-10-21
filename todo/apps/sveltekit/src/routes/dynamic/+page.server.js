// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { nextDynamicTodoState } from "#lib/server-state.mjs";

export function load({ setHeaders }) {
  setHeaders({
    "cache-control": "no-store, no-cache, must-revalidate",
  });
  return {
    initialState: nextDynamicTodoState(),
  };
}
