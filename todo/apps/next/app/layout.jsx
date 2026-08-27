// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import "../../../shared/styles.css";
import Link from "next/link";

export const metadata = {
  title: "SSR Todo Benchmark",
  description: "Equivalent full-stack todo SSR benchmark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="workspace-shell">
          <header className="workspace-nav">
            <Link className="workspace-brand" href="/dynamic">
              <span className="workspace-brand__mark" aria-hidden="true">W</span>
              <span>
                <strong>Workstream</strong>
                <small>Migration benchmark</small>
              </span>
            </Link>
            <nav aria-label="Workspace">
              <Link data-route-link="work" href="/dynamic">Work queue</Link>
              <Link data-route-link="activity" href="/activity">Activity</Link>
              <Link data-route-link="settings" href="/settings">Settings</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
