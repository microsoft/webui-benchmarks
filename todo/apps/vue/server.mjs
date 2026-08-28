// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  renderToString,
  renderToWebStream,
} from "@vue/server-renderer";
import { createSSRApp } from "vue";
import WorkspaceApp from "./components/workspace-app.vue";
import { createWorkspaceRouter } from "./router.mjs";

async function createRoutedApp(state, requestPath) {
  const app = createSSRApp(WorkspaceApp, { state });
  const router = createWorkspaceRouter({ server: true });
  app.use(router);
  await router.push(requestPath);
  await router.isReady();
  return app;
}

export async function renderTodo(state, requestPath = "/dynamic") {
  return renderToString(await createRoutedApp(state, requestPath));
}

export async function renderTodoStream(state, requestPath = "/dynamic") {
  return renderToWebStream(await createRoutedApp(state, requestPath));
}
