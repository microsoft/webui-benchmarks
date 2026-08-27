// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { WebUIElement, observable } from "@microsoft/webui-framework";
import {
  saveSettings,
  selectDensity,
  toggleSetting,
} from "../../../../shared/workspace-interactions.mjs";

interface SettingsState {
  density: string;
  densityOptions: Array<Record<string, unknown>>;
  dirty: boolean;
  saved: boolean;
  statusLabel: string;
  toggles: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export class SettingsPage extends WebUIElement {
  @observable routeReady = false;
  @observable settings: SettingsState = {
    density: "comfortable",
    densityOptions: [],
    dirty: false,
    saved: false,
    statusLabel: "",
    toggles: [],
  };

  protected override hydratedCallback(): void {
    this.routeReady = true;
  }

  onClick(event: MouseEvent): void {
    const action = event.composedPath().find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return;
    const state = { settings: this.settings };
    if (action.dataset.action === "setting-density") {
      const density = action.dataset.density;
      if (density !== undefined) {
        this.settings = selectDensity(state, density).settings;
      }
    } else if (action.dataset.action === "settings-save") {
      this.settings = saveSettings(state).settings;
    } else if (
      action.dataset.action === "setting-toggle"
      && action.dataset.settingId !== undefined
    ) {
      this.settings = toggleSetting(
        { settings: this.settings },
        action.dataset.settingId,
      ).settings;
    }
  }
}

SettingsPage.define("settings-page");
