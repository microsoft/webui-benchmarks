// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function WorkspaceShell({ children }) {
  return (
    <div className="workspace-shell">
      <header className="workspace-nav">
        <a className="workspace-brand" href="/dynamic">
          <span className="workspace-brand__mark" aria-hidden="true">W</span>
          <span>
            <strong>Workstream</strong>
            <small>Migration benchmark</small>
          </span>
        </a>
        <nav aria-label="Workspace">
          <a data-route-link="work" href="/dynamic">Work queue</a>
          <a data-route-link="activity" href="/activity">Activity</a>
          <a data-route-link="settings" href="/settings">Settings</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
