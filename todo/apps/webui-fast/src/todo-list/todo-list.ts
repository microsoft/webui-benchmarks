// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";

export class TodoList extends FASTElement {
  @observable rendertodos: unknown[] = [];

  private resetting = false;

  rendertodosChanged(previous: unknown, next: unknown): void {
    if (
      this.resetting
      || !Array.isArray(previous)
      || !Array.isArray(next)
      || previous.length <= next.length
    ) {
      return;
    }
    this.resetting = true;
    this.rendertodos = [];
    queueMicrotask(() => {
      this.rendertodos = next;
      this.resetting = false;
    });
  }
}

void TodoList.define(
  { name: "todo-list", template: declarativeTemplate() },
  [observerMap()],
);
