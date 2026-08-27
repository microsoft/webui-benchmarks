// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
} from "vue-router";
import ActivityPage from "./components/activity-page.vue";
import SettingsPage from "./components/settings-page.vue";
import TodoApp from "./components/todo-app.vue";

const routes = [
  { component: TodoApp, path: "/" },
  { component: TodoApp, path: "/dynamic" },
  { component: TodoApp, path: "/cached" },
  { component: ActivityPage, path: "/activity" },
  { component: SettingsPage, path: "/settings" },
];

export function createWorkspaceRouter({ server = false } = {}) {
  return createRouter({
    history: server
      ? createMemoryHistory()
      : createWebHistory(),
    routes,
  });
}
