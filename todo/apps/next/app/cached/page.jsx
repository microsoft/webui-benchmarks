// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import TodoApp from "../../components/todo-app.jsx";
import { CACHED_TODO_STATE } from "../../lib/server-state.mjs";

export const dynamic = "force-static";
export const fetchCache = "force-cache";
export const revalidate = false;

export default function CachedTodoBenchmark() {
  return (
    <TodoApp
      initialState={CACHED_TODO_STATE}
      renderMode="cached"
    />
  );
}
