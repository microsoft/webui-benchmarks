// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { generateHydrationScript, renderToString } from "solid-js/web";
import { ActivityPage } from "./components/activity-page.jsx";
import { SettingsPage } from "./components/settings-page.jsx";
import { TodoApp } from "./components/todo-app.jsx";
import { WorkspaceShell } from "./components/workspace-shell.jsx";

export function renderTodo(state, requestPath = "/dynamic") {
  const page = requestPath === "/activity"
    ? <ActivityPage state={state} />
    : requestPath === "/settings"
      ? <SettingsPage state={state} />
      : <TodoApp state={state} />;
  return renderToString(
    () => <WorkspaceShell>{page}</WorkspaceShell>,
  );
}

export function renderHydrationScript() {
  return generateHydrationScript();
}
