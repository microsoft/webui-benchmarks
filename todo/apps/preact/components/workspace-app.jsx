// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LocationProvider, Route, Router } from "preact-iso";
import { ActivityPage } from "./activity-page.jsx";
import { SettingsPage } from "./settings-page.jsx";
import { TodoApp } from "./todo-app.jsx";
import { WorkspaceShell } from "./workspace-shell.jsx";

export function WorkspaceApp({ state, url }) {
  const routeProps = url === undefined ? {} : { url };
  return (
    <LocationProvider {...routeProps}>
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
