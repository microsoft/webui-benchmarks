// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToString } from "preact-render-to-string";
import { renderToReadableStream } from "preact-render-to-string/stream";
import { WorkspaceApp } from "./components/workspace-app.jsx";

globalThis.location ??= new URL("http://localhost/");

export function renderTodo(state, requestPath = "/dynamic") {
  return renderToString(<WorkspaceApp state={state} url={requestPath} />);
}

export function renderTodoStream(state, requestPath = "/dynamic") {
  return renderToReadableStream(
    <WorkspaceApp state={state} url={requestPath} />,
  );
}
