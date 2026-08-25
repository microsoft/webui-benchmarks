// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";

export class TodoItem extends FASTElement {}

void TodoItem.define(
  { name: "todo-item", template: declarativeTemplate() },
  [observerMap()],
);
