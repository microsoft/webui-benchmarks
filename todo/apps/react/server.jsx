// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToString } from "react-dom/server";
import { TodoApp } from "./components/todo-app.jsx";

export function renderTodo(state) {
  return renderToString(<TodoApp state={state} />);
}
