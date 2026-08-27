// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { WorkspaceClientApp } from "./components/workspace-app-client.jsx";

export function hydrateTodoApp(target, state, options = undefined) {
  return hydrateRoot(
    target,
    <BrowserRouter>
      <WorkspaceClientApp state={state} />
    </BrowserRouter>,
    options,
  );
}
