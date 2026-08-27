// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Link, Outlet } from "react-router";

export function WorkspaceShell() {
  return (
    <div className="workspace-shell">
      <header className="workspace-nav">
        <Link className="workspace-brand" to="/dynamic">
          <span className="workspace-brand__mark" aria-hidden="true">W</span>
          <span>
            <strong>Workstream</strong>
            <small>Migration benchmark</small>
          </span>
        </Link>
        <nav aria-label="Workspace">
          <Link data-route-link="work" to="/dynamic">Work queue</Link>
          <Link data-route-link="activity" to="/activity">Activity</Link>
          <Link data-route-link="settings" to="/settings">Settings</Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
