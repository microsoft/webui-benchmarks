// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  RouterServer,
  createRequestHandler,
  renderRouterToString,
} from "@tanstack/react-router/ssr/server";
import {
  WorkspaceStateProvider,
  createWorkspaceRouter,
} from "./router.jsx";

export async function renderTodo(state, requestPath = "/dynamic") {
  const request = new Request(
    new URL(requestPath, "http://react-tanstack.local"),
  );
  const handler = createRequestHandler({
    request,
    createRouter: () => createWorkspaceRouter(),
  });
  const response = await handler(
    ({ responseHeaders, router }) =>
      renderRouterToString({
        responseHeaders,
        router,
        children: (
          <html lang="en">
            <head>
              <meta charSet="utf-8" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
              />
              <title>React TanStack · SSR Todo Benchmark</title>
              <link rel="stylesheet" href="/__browser/styles.css" />
            </head>
            <body>
              <div id="todo-browser-root">
                <WorkspaceStateProvider state={state}>
                  <RouterServer router={router} />
                </WorkspaceStateProvider>
              </div>
            </body>
          </html>
        ),
      }),
  );
  if (!response.ok) {
    throw new Error(`TanStack SSR returned HTTP ${response.status}`);
  }
  return response.text();
}
