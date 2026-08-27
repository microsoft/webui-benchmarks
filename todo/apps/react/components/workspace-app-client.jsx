// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router";
import { TodoApp } from "./todo-app.jsx";
import { WorkspaceShell } from "./workspace-shell.jsx";

const ActivityPage = lazy(() =>
  import("./activity-page.jsx").then((module) => ({
    default: module.ActivityPage,
  }))
);
const SettingsPage = lazy(() =>
  import("./settings-page.jsx").then((module) => ({
    default: module.SettingsPage,
  }))
);

export function WorkspaceClientApp({ state }) {
  return (
    <Routes>
      <Route element={<WorkspaceShell />}>
        <Route path="/" element={<TodoApp state={state} />} />
        <Route path="/dynamic" element={<TodoApp state={state} />} />
        <Route path="/cached" element={<TodoApp state={state} />} />
        <Route
          path="/activity"
          element={(
            <Suspense fallback={null}>
              <ActivityPage state={state} />
            </Suspense>
          )}
        />
        <Route
          path="/settings"
          element={(
            <Suspense fallback={null}>
              <SettingsPage state={state} />
            </Suspense>
          )}
        />
      </Route>
    </Routes>
  );
}
