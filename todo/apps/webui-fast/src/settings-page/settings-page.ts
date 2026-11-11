// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";
import type { RouteLoaderContext } from "@microsoft/webui-delivery/router.js";
import {
  saveSettings,
  selectDensity,
  toggleSetting,
} from "../../../../shared/workspace-interactions.mjs";
import "../setting-toggle/setting-toggle.js";

interface SettingsState {
  density: string;
  densityOptions: Array<Record<string, unknown>>;
  dirty: boolean;
  saved: boolean;
  statusLabel: string;
  toggles: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const EMPTY_SETTINGS: SettingsState = {
  density: "comfortable",
  densityOptions: [],
  dirty: false,
  saved: false,
  statusLabel: "",
  toggles: [],
};

function initialSettings(): SettingsState {
  const data = document.querySelector("#webui-data");
  if (!(data instanceof HTMLScriptElement)) return EMPTY_SETTINGS;
  const payload: unknown = JSON.parse(data.textContent ?? "");
  if (
    payload !== null
    && typeof payload === "object"
    && "state" in payload
    && payload.state !== null
    && typeof payload.state === "object"
    && "settings" in payload.state
  ) {
    return payload.state.settings as SettingsState;
  }
  return EMPTY_SETTINGS;
}

export class SettingsPage extends FASTElement {
  @observable routeReady = false;
  @observable title = "";
  @observable description = "";
  @observable density = "comfortable";
  @observable densityOptions: Array<Record<string, unknown>> = [];
  @observable dirty = false;
  @observable saved = false;
  @observable statusLabel = "";
  @observable toggles: Array<Record<string, unknown>> = [];

  static async loader(
    { signal }: RouteLoaderContext,
  ): Promise<SettingsState> {
    const response = await fetch("/__bench/route-state", { signal });
    if (!response.ok) {
      throw new Error(`Route state returned HTTP ${response.status}`);
    }
    const state: unknown = await response.json();
    if (
      state === null
      || typeof state !== "object"
      || !("settings" in state)
      || state.settings === null
      || typeof state.settings !== "object"
    ) {
      throw new TypeError("Route state is missing settings");
    }
    return state.settings as SettingsState;
  }

  connectedCallback(): void {
    if (this.toggles.length === 0) {
      this.applySettings(initialSettings());
    }
    super.connectedCallback();
    this.routeReady = true;
  }

  setState(state: Record<string, unknown>): void {
    const settings = state.settings !== null
        && typeof state.settings === "object"
      ? state.settings as SettingsState
      : state as SettingsState;
    this.applySettings(settings);
  }

  onClick(event: MouseEvent): void {
    const action = event.composedPath().find(
      (candidate): candidate is HTMLElement =>
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
  }

  private state(): SettingsState {
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

  private applySettings(settings: SettingsState): void {
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
  }
}

void SettingsPage.define(
  { name: "settings-page", template: declarativeTemplate() },
  [observerMap()],
);
