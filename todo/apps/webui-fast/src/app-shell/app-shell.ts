// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";

export class AppShell extends FASTElement {}

void AppShell.define({
  name: "app-shell",
  template: declarativeTemplate(),
});
