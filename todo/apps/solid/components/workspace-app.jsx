// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Route, Router } from "@solidjs/router";
import { Suspense, lazy } from "solid-js";
import { TodoApp } from "./todo-app.jsx";
import { WorkspaceShell } from "./workspace-shell.jsx";

const ActivityPage = lazy(() => import("./activity-page.jsx").then(
  (module) => ({ default: module.ActivityPage }),
));
const SettingsPage = lazy(() => import("./settings-page.jsx").then(
  (module) => ({ default: module.SettingsPage }),
));

export async function loadInitialWorkspaceRoute(pathname) {
  if (pathname === "/activity") {
    const { ActivityPage: activityPage } = await import("./activity-page.jsx");
    return { activityPage };
  }
  if (pathname === "/settings") {
    const { SettingsPage: settingsPage } = await import("./settings-page.jsx");
    return { settingsPage };
  }
  return {};
}

export function WorkspaceApp(props) {
  const WorkRoute = () => <TodoApp state={props.state} />;
  const ActivityRoute = () => {
    if (props.activityPage !== undefined) {
      return <props.activityPage state={props.state} />;
    }
    return (
      <Suspense>
        <ActivityPage state={props.state} />
      </Suspense>
    );
  };
  const SettingsRoute = () => {
    if (props.settingsPage !== undefined) {
      return <props.settingsPage state={props.state} />;
    }
    return (
      <Suspense>
        <SettingsPage state={props.state} />
      </Suspense>
    );
  };
  return (
    <Router root={WorkspaceShell} url={props.url}>
      <Route path={["/", "/dynamic", "/cached"]} component={WorkRoute} />
      <Route path="/activity" component={ActivityRoute} />
      <Route path="/settings" component={SettingsRoute} />
    </Router>
  );
}
