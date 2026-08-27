// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";

export class SettingToggle extends FASTElement {
  @observable enabled = false;
  @observable settingid = "";

  input!: HTMLInputElement;

  enabledChanged(_previous: boolean, next: boolean): void {
    queueMicrotask(() => {
      if (this.input !== undefined) {
        this.input.checked = next;
      }
    });
  }
}

void SettingToggle.define(
  { name: "setting-toggle", template: declarativeTemplate() },
  [observerMap()],
);
