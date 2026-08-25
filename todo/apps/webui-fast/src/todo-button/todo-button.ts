// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";

export class TodoButton extends FASTElement {
  @observable hascompleted = false;

  hascompletedChanged(_previous: boolean, next: boolean): void {
    queueMicrotask(() => {
      const clearButton = this.shadowRoot?.querySelector(
        '[data-action="clear-completed"]',
      );
      if (clearButton instanceof HTMLButtonElement) {
        clearButton.disabled = !next;
      }
    });
  }
}

void TodoButton.define(
  { name: "todo-button", template: declarativeTemplate() },
  [observerMap()],
);
