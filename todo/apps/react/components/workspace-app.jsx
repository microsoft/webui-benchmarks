// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Route, Routes } from "react-router";
import { ActivityPage } from "./activity-page.jsx";
import { SettingsPage } from "./settings-page.jsx";
import { TodoApp } from "./todo-app.jsx";
import { WorkspaceShell } from "./workspace-shell.jsx";

export function WorkspaceApp({ state }) {
  return (
    <Routes>
      <Route element={<WorkspaceShell />}>
        <Route path="/" element={<TodoApp state={state} />} />
        <Route path="/dynamic" element={<TodoApp state={state} />} />
        <Route path="/cached" element={<TodoApp state={state} />} />
        <Route path="/activity" element={<ActivityPage state={state} />} />
        <Route path="/settings" element={<SettingsPage state={state} />} />
      </Route>
    </Routes>
  );
}
