// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  generateHydrationScript,
  renderToStream,
  renderToString,
} from "solid-js/web";
import { PassThrough, Readable } from "node:stream";
import { ActivityPage } from "./components/activity-page.jsx";
import { SettingsPage } from "./components/settings-page.jsx";
import { TodoApp } from "./components/todo-app.jsx";
import { WorkspaceShell } from "./components/workspace-shell.jsx";

function workspace(state, requestPath) {
  const page = requestPath === "/activity"
    ? <ActivityPage state={state} />
    : requestPath === "/settings"
      ? <SettingsPage state={state} />
      : <TodoApp state={state} />;
  return <WorkspaceShell>{page}</WorkspaceShell>;
}

export function renderTodo(state, requestPath = "/dynamic") {
  return renderToString(() => workspace(state, requestPath));
}

export function renderTodoStream(state, requestPath = "/dynamic") {
  const output = new PassThrough();
  renderToStream(
    () => workspace(state, requestPath),
    { onError: (error) => output.destroy(error) },
  ).pipe(output);
  return Readable.toWeb(output);
}

export function renderHydrationScript() {
  return generateHydrationScript();
}
