// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createContext, useContext } from "react";

const WorkspaceState = createContext(null);

export function useWorkspaceState() {
  const state = useContext(WorkspaceState);
  if (state === null) {
    throw new Error("The TanStack workspace state provider is missing");
  }
  return state;
}

export function WorkspaceStateProvider({ children, state }) {
  return (
    <WorkspaceState.Provider value={state}>
      {children}
    </WorkspaceState.Provider>
  );
}
