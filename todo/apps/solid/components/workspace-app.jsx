// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Route, Router } from "@solidjs/router";
import { ActivityPage } from "./activity-page.jsx";
import { SettingsPage } from "./settings-page.jsx";
import { TodoApp } from "./todo-app.jsx";
import { WorkspaceShell } from "./workspace-shell.jsx";

export function WorkspaceApp(props) {
  const WorkRoute = () => <TodoApp state={props.state} />;
  const ActivityRoute = () => <ActivityPage state={props.state} />;
  const SettingsRoute = () => <SettingsPage state={props.state} />;
  return (
    <Router root={WorkspaceShell} url={props.url}>
      <Route path={["/", "/dynamic", "/cached"]} component={WorkRoute} />
      <Route path="/activity" component={ActivityRoute} />
      <Route path="/settings" component={SettingsRoute} />
    </Router>
  );
}
