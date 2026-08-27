// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
} from "vue-router";
import TodoApp from "./components/todo-app.vue";

const routes = [
  { component: TodoApp, path: "/" },
  { component: TodoApp, path: "/dynamic" },
  { component: TodoApp, path: "/cached" },
  {
    component: () => import("./components/activity-page.vue"),
    path: "/activity",
  },
  {
    component: () => import("./components/settings-page.vue"),
    path: "/settings",
  },
];

export function createWorkspaceRouter({ server = false } = {}) {
  return createRouter({
    history: server
      ? createMemoryHistory()
      : createWebHistory(),
    routes,
  });
}
