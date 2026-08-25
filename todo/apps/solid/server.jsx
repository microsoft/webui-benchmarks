// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { generateHydrationScript, renderToString } from "solid-js/web";
import { TodoApp } from "./components/todo-app.jsx";

export function renderTodo(state) {
  return renderToString(() => <TodoApp state={state} />);
}

export function renderHydrationScript() {
  return generateHydrationScript();
}
