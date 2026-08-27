// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { For, createSignal, onMount } from "solid-js";
import {
  saveSettings,
  selectDensity,
  toggleSetting,
} from "../../../shared/workspace-interactions.mjs";

export function SettingsPage(props) {
  const [current, setCurrent] = createSignal(props.state);
  const [routeReady, setRouteReady] = createSignal(false);
  const settings = () => current().settings;
  onMount(() => setRouteReady(true));

  return (
    <main
      class="workspace-page settings-page"
      data-density={settings().density}
      data-route-page="settings"
      data-route-ready={routeReady() || undefined}
    >
      <header class="workspace-page__header">
        <div>
          <h1>{settings().title}</h1>
          <p>{settings().description}</p>
        </div>
        <span class="settings-status" role="status">
          {settings().statusLabel}
        </span>
      </header>
      <section class="settings-section">
        <h2>Interface density</h2>
        <div class="settings-density" role="group" aria-label="Interface density">
          <For each={settings().densityOptions}>
            {(option) => (
              <button
                aria-pressed={option.selected}
                data-action="setting-density"
                data-density={option.id}
                onClick={() =>
                  setCurrent((value) => selectDensity(value, option.id))}
                type="button"
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </section>
      <section class="settings-section">
        <h2>Workspace behavior</h2>
        <div class="settings-grid">
          <For each={settings().toggles}>
            {(setting) => (
              <label class="setting-control">
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
            )}
          </For>
        </div>
      </section>
      <footer class="settings-actions">
        <button
          class="workspace-action"
          data-action="settings-save"
          disabled={!settings().dirty}
          onClick={() => setCurrent(saveSettings)}
          type="button"
        >
          Save preferences
        </button>
      </footer>
    </main>
  );
}
