// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrateRoot } from "react-dom/client";
import { TodoApp } from "./components/todo-app.jsx";

export function hydrateTodoApp(target, state, options = undefined) {
  return hydrateRoot(target, <TodoApp state={state} />, options);
}
