// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { RouterClient } from "@tanstack/react-router/ssr/client";
import { hydrateRoot } from "react-dom/client";
import {
  WorkspaceStateProvider,
  createWorkspaceRouter,
} from "./router.jsx";

export async function hydrateTodoApp(target, state, options = undefined) {
  const router = createWorkspaceRouter();
  return hydrateRoot(
    target,
    <WorkspaceStateProvider state={state}>
      <RouterClient router={router} />
    </WorkspaceStateProvider>,
    options,
  );
}
