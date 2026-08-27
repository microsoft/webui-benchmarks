// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { WorkspaceApp } from "./components/workspace-app.jsx";

export function renderTodo(state, requestPath = "/dynamic") {
  return renderToString(
    <StaticRouter location={requestPath}>
      <WorkspaceApp state={state} />
    </StaticRouter>,
  );
}
