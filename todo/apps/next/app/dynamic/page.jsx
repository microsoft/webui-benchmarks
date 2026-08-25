// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import TodoApp from "../../components/todo-app.jsx";
import { nextDynamicTodoState } from "../../lib/server-state.mjs";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const runtime = "nodejs";

export default function DynamicTodoBenchmark() {
  return (
    <TodoApp
      initialState={nextDynamicTodoState()}
      renderMode="dynamic"
    />
  );
}
