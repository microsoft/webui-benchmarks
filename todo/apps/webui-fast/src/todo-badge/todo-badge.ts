// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";

export class TodoBadge extends FASTElement {}

void TodoBadge.define(
  { name: "todo-badge", template: declarativeTemplate() },
  [observerMap()],
);
