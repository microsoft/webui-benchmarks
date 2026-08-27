// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToString } from "@vue/server-renderer";
import { createSSRApp } from "vue";
import WorkspaceApp from "./components/workspace-app.vue";
import { createWorkspaceRouter } from "./router.mjs";

export async function renderTodo(state, requestPath = "/dynamic") {
  const app = createSSRApp(WorkspaceApp, { state });
  const router = createWorkspaceRouter({ server: true });
  app.use(router);
  await router.push(requestPath);
  await router.isReady();
  return renderToString(app);
}
