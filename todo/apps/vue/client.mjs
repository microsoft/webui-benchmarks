// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createSSRApp } from "vue";
import TodoApp from "./components/todo-app.vue";
import WorkspaceApp from "./components/workspace-app.vue";
import { createWorkspaceRouter } from "./router.mjs";

export { TodoApp, WorkspaceApp };

/**
 * Activates the server-rendered markup in `target` by mounting the very same
 * single file components the SSR bundle used, so Vue adopts the existing DOM
 * instead of recreating it.
 */
export async function hydrateTodo(target, state) {
  const app = createSSRApp(WorkspaceApp, { state });
  const router = createWorkspaceRouter();
  app.use(router);
  await router.isReady();
  return app.mount(target);
}

export default hydrateTodo;
