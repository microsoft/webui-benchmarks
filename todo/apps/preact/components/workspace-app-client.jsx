// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LocationProvider, Route, Router, lazy } from "preact-iso";
import { TodoApp } from "./todo-app.jsx";
import { WorkspaceShell } from "./workspace-shell.jsx";

const ActivityPage = lazy(() =>
  import("./activity-page.jsx").then((module) => module.ActivityPage)
);
const SettingsPage = lazy(() =>
  import("./settings-page.jsx").then((module) => module.SettingsPage)
);

export function WorkspaceClientApp({ state }) {
  return (
    <LocationProvider>
      <WorkspaceShell>
        <Router>
          <Route path="/" component={() => <TodoApp state={state} />} />
          <Route
            path="/dynamic"
            component={() => <TodoApp state={state} />}
          />
          <Route
            path="/cached"
            component={() => <TodoApp state={state} />}
          />
          <Route
            path="/activity"
            component={() => <ActivityPage state={state} />}
          />
          <Route
            path="/settings"
            component={() => <SettingsPage state={state} />}
          />
        </Router>
      </WorkspaceShell>
    </LocationProvider>
  );
}
