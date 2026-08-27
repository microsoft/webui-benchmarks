// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createLazyRoute } from "@tanstack/react-router";
import { SettingsPage } from "../react/components/settings-page.jsx";
import { useWorkspaceState } from "./workspace-state.jsx";

export const Route = createLazyRoute("/settings")({
  component: () => <SettingsPage state={useWorkspaceState()} />,
});
