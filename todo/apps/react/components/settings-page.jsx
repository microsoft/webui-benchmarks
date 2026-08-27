// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

"use client";

import { useEffect, useState } from "react";
import {
  saveSettings,
  selectDensity,
  toggleSetting,
} from "../../../shared/workspace-interactions.mjs";

export function SettingsPage({ state }) {
  const [current, setCurrent] = useState(state);
  const [routeReady, setRouteReady] = useState(false);
  const settings = current.settings;
  useEffect(() => setRouteReady(true), []);

  return (
    <main
      className="workspace-page settings-page"
      data-density={settings.density}
      data-route-page="settings"
      data-route-ready={routeReady || undefined}
    >
      <header className="workspace-page__header">
        <div>
          <h1>{settings.title}</h1>
          <p>{settings.description}</p>
        </div>
        <span className="settings-status" role="status">
          {settings.statusLabel}
        </span>
      </header>
      <section className="settings-section">
        <h2>Interface density</h2>
        <div className="settings-density" role="group" aria-label="Interface density">
          {settings.densityOptions.map((option) => (
            <button
              aria-pressed={option.selected}
              data-action="setting-density"
              data-density={option.id}
              key={option.id}
              onClick={() =>
                setCurrent((value) => selectDensity(value, option.id))}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h2>Workspace behavior</h2>
        <div className="settings-grid">
          {settings.toggles.map((setting) => (
            <label className="setting-control" key={setting.id}>
              <span>
                <strong>{setting.label}</strong>
                <small>{setting.description}</small>
              </span>
              <input
                checked={setting.enabled}
                data-action="setting-toggle"
                data-setting-id={setting.id}
                onChange={() =>
                  setCurrent((value) => toggleSetting(value, setting.id))}
                type="checkbox"
              />
            </label>
          ))}
        </div>
      </section>
      <footer className="settings-actions">
        <button
          className="workspace-action"
          data-action="settings-save"
          disabled={!settings.dirty}
          onClick={() => setCurrent(saveSettings)}
          type="button"
        >
          Save preferences
        </button>
      </footer>
    </main>
  );
}
