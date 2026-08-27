// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrate } from "preact";
import { WorkspaceClientApp } from "./components/workspace-app-client.jsx";

export function hydrateTodoApp(target, state) {
  hydrate(<WorkspaceClientApp state={state} />, target);
  return target;
}
