// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
} from "../../../../shared/state.mjs";

let dynamicCursor = 0;

export const CACHED_TODO_STATE =
  createRequestTodoState(TODO_STATE_VARIANTS[0]);

export function nextDynamicTodoState() {
  const state = TODO_STATE_VARIANTS[dynamicCursor];
  dynamicCursor = (dynamicCursor + 1) % TODO_STATE_VARIANTS.length;
  return createRequestTodoState(state);
}
