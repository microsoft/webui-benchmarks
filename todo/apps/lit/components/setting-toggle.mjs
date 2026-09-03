// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { settingToggle } from "../component-styles.mjs";

export class SettingToggle extends LitElement {
  static properties = {
    enabled: { type: Boolean },
    settingid: {},
  };

  static styles = settingToggle;

  constructor() {
    super();
    this.enabled = false;
    this.settingid = "";
  }

  render() {
    return html`<input
      ?checked=${this.enabled}
      data-action="setting-toggle"
      data-setting-id="${this.settingid}"
      type="checkbox"
    />`;
  }
}

customElements.define("setting-toggle", SettingToggle);
