// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToString } from "@vue/server-renderer";
import { createSSRApp } from "vue";
import TodoApp from "./components/todo-app.vue";

export function renderTodo(state) {
  return renderToString(createSSRApp(TodoApp, { state }));
}
