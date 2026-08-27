// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  Link,
  Outlet,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { TodoApp } from "../react/components/todo-app.jsx";
import {
  WorkspaceStateProvider,
  useWorkspaceState,
} from "./workspace-state.jsx";

export { WorkspaceStateProvider };

function WorkspaceShell() {
  return (
    <div className="workspace-shell">
      <header className="workspace-nav">
        <Link className="workspace-brand" to="/dynamic">
          <span className="workspace-brand__mark" aria-hidden="true">W</span>
          <span>
            <strong>Workstream</strong>
            <small>Migration benchmark</small>
          </span>
        </Link>
        <nav aria-label="Workspace">
          <Link data-route-link="work" to="/dynamic">Work queue</Link>
          <Link data-route-link="activity" to="/activity">Activity</Link>
          <Link data-route-link="settings" to="/settings">Settings</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

function WorkRoute() {
  return (
    <TodoApp
      hydrationId="react-tanstack"
      state={useWorkspaceState()}
    />
  );
}

const rootRoute = createRootRoute({ component: WorkspaceShell });
const routeTree = rootRoute.addChildren([
  createRoute({
    component: WorkRoute,
    getParentRoute: () => rootRoute,
    path: "/",
  }),
  createRoute({
    component: WorkRoute,
    getParentRoute: () => rootRoute,
    path: "/dynamic",
  }),
  createRoute({
    component: WorkRoute,
    getParentRoute: () => rootRoute,
    path: "/cached",
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/activity",
  }).lazy(() => import("./activity-route.lazy.jsx").then(({ Route }) => Route)),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
  }).lazy(() => import("./settings-route.lazy.jsx").then(({ Route }) => Route)),
]);

export function createWorkspaceRouter(requestPath) {
  return createRouter({
    ...(requestPath === undefined
      ? {}
      : {
          history: createMemoryHistory({
            initialEntries: [requestPath],
          }),
        }),
    routeTree,
  });
}
