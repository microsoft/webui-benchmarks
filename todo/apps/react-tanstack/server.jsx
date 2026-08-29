// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  RouterServer,
  createRequestHandler,
  renderRouterToStream,
  renderRouterToString,
} from "@tanstack/react-router/ssr/server";
import {
  WorkspaceStateProvider,
  createWorkspaceRouter,
} from "./router.jsx";

export const ownsDocument = true;

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function document(state, router) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <meta name="todo-browser-app" content="react-tanstack" />
        <title>React TanStack · SSR Todo Benchmark</title>
        <link rel="stylesheet" href="/__browser/styles.css" />
      </head>
      <body>
        <div id="todo-browser-root">
          <WorkspaceStateProvider state={state}>
            <RouterServer router={router} />
          </WorkspaceStateProvider>
        </div>
        <script
          id="todo-bench-initial-state"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: safeJson(state) }}
        />
        <script type="module" src="/__browser/react-tanstack.js" />
      </body>
    </html>
  );
}

function requestHandler(requestPath, signal) {
  const request = new Request(
    new URL(requestPath, "http://react-tanstack.local"),
    signal === undefined ? undefined : { signal },
  );
  const handler = createRequestHandler({
    request,
    createRouter: () => createWorkspaceRouter(),
  });
  return { handler, request };
}

export async function renderTodo(state, requestPath = "/dynamic") {
  const { handler } = requestHandler(requestPath);
  const response = await handler(
    ({ responseHeaders, router }) =>
      renderRouterToString({
        responseHeaders,
        router,
        children: document(state, router),
      }),
  );
  if (!response.ok) {
    throw new Error(`TanStack SSR returned HTTP ${response.status}`);
  }
  return response.text();
}

export async function renderTodoStream(
  state,
  requestPath = "/dynamic",
  { signal } = {},
) {
  const { handler, request } = requestHandler(requestPath, signal);
  const response = await handler(
    ({ responseHeaders, router }) =>
      renderRouterToStream({
        children: document(state, router),
        request,
        responseHeaders,
        router,
      }),
  );
  if (!response.ok || response.body === null) {
    throw new Error(`TanStack stream returned HTTP ${response.status}`);
  }
  return response.body;
}
