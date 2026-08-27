// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrate } from "preact";
import { WorkspaceApp } from "./components/workspace-app.jsx";

export function hydrateTodoApp(target, state) {
  hydrate(<WorkspaceApp state={state} />, target);
  return target;
}
