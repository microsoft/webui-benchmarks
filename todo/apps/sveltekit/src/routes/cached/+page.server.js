// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { CACHED_TODO_STATE } from "$lib/server-state.mjs";

export function load({ setHeaders }) {
  setHeaders({
    "cache-control": "public, max-age=31536000, immutable",
  });
  return {
    initialState: CACHED_TODO_STATE,
  };
}
