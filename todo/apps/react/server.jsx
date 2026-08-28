// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  renderToReadableStream,
  renderToString,
} from "react-dom/server";
import { StaticRouter } from "react-router";
import { WorkspaceApp } from "./components/workspace-app.jsx";

function workspace(state, requestPath) {
  return (
    <StaticRouter location={requestPath}>
      <WorkspaceApp state={state} />
    </StaticRouter>
  );
}

export function renderTodo(state, requestPath = "/dynamic") {
  return renderToString(workspace(state, requestPath));
}

export async function renderTodoStream(
  state,
  requestPath = "/dynamic",
  { signal } = {},
) {
  const abort = new AbortController();
  const renderSignal = signal === undefined
    ? abort.signal
    : AbortSignal.any([abort.signal, signal]);
  const stream = await renderToReadableStream(
    workspace(state, requestPath),
    { signal: renderSignal },
  );
  const reader = stream.getReader();
  return new ReadableStream({
    async cancel(reason) {
      abort.abort(reason);
      try {
        await Promise.allSettled([
          reader.cancel(reason),
          stream.allReady,
        ]);
      } finally {
        reader.releaseLock();
      }
    },
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        reader.releaseLock();
        controller.close();
      } else {
        controller.enqueue(result.value);
      }
    },
  });
}
