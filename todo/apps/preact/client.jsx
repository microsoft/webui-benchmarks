// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrate } from "preact";
import { TodoApp } from "./components/todo-app.jsx";

export function hydrateTodoApp(target, state) {
  hydrate(<TodoApp state={state} />, target);
  return target;
}
