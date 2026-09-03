// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { shared } from "../component-styles.mjs";
import {
  saveSettings,
  selectDensity,
  toggleSetting,
} from "../../../shared/workspace-interactions.mjs";
import "./setting-toggle.mjs";

/**
 * Secondary route page ported 1:1 from the FAST settings-page. State arrives as
 * reactive properties from the parent workspace-app; this element owns the
 * delegated click handling and reduces through the shared reducers, mutating
 * its own reactive properties in place exactly like the FAST applySettings.
 */
export class SettingsPage extends LitElement {
  static properties = {
    routeReady: { type: Boolean },
    title: {},
    description: {},
    density: {},
    densityOptions: { type: Array },
    dirty: { type: Boolean },
    saved: { type: Boolean },
    statusLabel: {},
    toggles: { type: Array },
  };

  static styles = shared;

  constructor() {
    super();
    this.routeReady = false;
    this.title = "";
    this.description = "";
    this.density = "comfortable";
    this.densityOptions = [];
    this.dirty = false;
    this.saved = false;
    this.statusLabel = "";
    this.toggles = [];
  }

  firstUpdated() {
    this.routeReady = true;
  }

  onClick = (event) => {
    const action = event.composedPath().find(
      (candidate) =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return;
    const state = { settings: this.state() };
    if (action.dataset.action === "setting-density") {
      const density = action.dataset.density;
      if (density !== undefined) {
        this.applySettings(selectDensity(state, density).settings);
      }
    } else if (action.dataset.action === "settings-save") {
      this.applySettings(saveSettings(state).settings);
    } else if (
      action.dataset.action === "setting-toggle"
      && action.dataset.settingId !== undefined
    ) {
      this.applySettings(
        toggleSetting(
          { settings: this.state() },
          action.dataset.settingId,
        ).settings,
      );
    }
  };

  state() {
    return {
      density: this.density,
      densityOptions: this.densityOptions,
      description: this.description,
      dirty: this.dirty,
      saved: this.saved,
      statusLabel: this.statusLabel,
      title: this.title,
      toggles: this.toggles,
    };
  }

  applySettings(settings) {
    this.title = String(settings.title ?? "");
    this.description = String(settings.description ?? "");
    this.density = settings.density;
    if (this.densityOptions.length === settings.densityOptions.length) {
      this.densityOptions.forEach((option, index) => {
        option.selected = settings.densityOptions[index].selected;
      });
    } else {
      this.densityOptions = settings.densityOptions;
    }
    this.dirty = settings.dirty;
    this.saved = settings.saved;
    this.statusLabel = settings.statusLabel;
    if (this.toggles.length === settings.toggles.length) {
      this.toggles.forEach((setting, index) => {
        setting.enabled = settings.toggles[index].enabled;
      });
    } else {
      this.toggles = settings.toggles;
    }
    this.requestUpdate();
  }

  render() {
    return html`<main
      class="workspace-page settings-page"
      data-density="${this.density}"
      data-route-page="settings"
      ?data-route-ready=${this.routeReady}
      @click=${this.onClick}
    >
      <header class="workspace-page__header">
        <div>
          <h1>${this.title}</h1>
          <p>${this.description}</p>
        </div>
        <span class="settings-status" role="status">
          ${this.statusLabel}
        </span>
      </header>
      <section class="settings-section">
        <h2>Interface density</h2>
        <div
          class="settings-density"
          role="group"
          aria-label="Interface density"
        >
          ${repeat(
            this.densityOptions,
            (option) => option.id,
            (option) => html`<button
              aria-pressed="${option.selected}"
              data-action="setting-density"
              data-density="${option.id}"
              type="button"
            >
              ${option.label}
            </button>`,
          )}
        </div>
      </section>
      <section class="settings-section">
        <h2>Workspace behavior</h2>
        <div class="settings-grid">
          ${repeat(
            this.toggles,
            (setting) => setting.id,
            (setting) => html`<label class="setting-control">
              <span>
                <strong>${setting.label}</strong>
                <small>${setting.description}</small>
              </span>
              <setting-toggle
                .enabled=${setting.enabled}
                .settingid=${setting.id}
              ></setting-toggle>
            </label>`,
          )}
        </div>
      </section>
      <footer class="settings-actions">
        <button
          class="workspace-action"
          data-action="settings-save"
          ?disabled=${!this.dirty}
          type="button"
        >
          Save preferences
        </button>
      </footer>
    </main>`;
  }
}

customElements.define("settings-page", SettingsPage);
