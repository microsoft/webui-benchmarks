// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createLazyRoute } from "@tanstack/react-router";
import { ActivityPage } from "../react/components/activity-page.jsx";
import { useWorkspaceState } from "./workspace-state.jsx";

export const Route = createLazyRoute("/activity")({
  component: () => <ActivityPage state={useWorkspaceState()} />,
});
