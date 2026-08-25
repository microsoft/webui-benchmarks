// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";

export class TodoCheckbox extends FASTElement {
  @observable completed = false;

  input!: HTMLInputElement;

  completedChanged(_previous: boolean, next: boolean): void {
    queueMicrotask(() => {
      if (this.input !== undefined) {
        this.input.checked = next;
      }
    });
  }
}

void TodoCheckbox.define(
  { name: "todo-checkbox", template: declarativeTemplate() },
  [observerMap()],
);
