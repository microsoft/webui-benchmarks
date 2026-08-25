// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createSSRApp } from "vue";
import TodoApp from "./components/todo-app.vue";

export { TodoApp };

/**
 * Activates the server-rendered markup in `target` by mounting the very same
 * single file components the SSR bundle used, so Vue adopts the existing DOM
 * instead of recreating it.
 */
export function hydrateTodo(target, state) {
  return createSSRApp(TodoApp, { state }).mount(target);
}

export default hydrateTodo;
