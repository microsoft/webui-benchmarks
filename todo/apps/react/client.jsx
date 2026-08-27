// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { WorkspaceApp } from "./components/workspace-app.jsx";

export function hydrateTodoApp(target, state, options = undefined) {
  return hydrateRoot(
    target,
    <BrowserRouter>
      <WorkspaceApp state={state} />
    </BrowserRouter>,
    options,
  );
}
