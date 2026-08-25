// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";

export class TodoSummary extends FASTElement {}

void TodoSummary.define(
  { name: "todo-summary", template: declarativeTemplate() },
  [observerMap()],
);
