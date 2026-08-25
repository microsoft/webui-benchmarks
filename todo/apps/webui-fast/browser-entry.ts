// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { enableHydration } from "@microsoft/fast-element/hydration.js";
import { publishHydrated } from "../../shared/hydration.mjs";

const hydration = enableHydration();
const { COMPONENT_NAMES } = await import("./component-definitions.js");
await Promise.all(
  COMPONENT_NAMES.map((name) => customElements.whenDefined(name)),
);
await hydration.whenHydrated();
publishHydrated("fast-v3");
