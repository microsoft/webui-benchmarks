// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { enableHydration } from "@microsoft/fast-element/hydration.js";
import { WebUIRouter } from "@microsoft/webui-delivery/router.js";
import { publishHydrated } from "../../shared/hydration.mjs";

const hydration = enableHydration();
const { COMPONENT_NAMES } = await import("./component-definitions.js");
await Promise.all(
  COMPONENT_NAMES.map((name) => customElements.whenDefined(name)),
);
await hydration.whenHydrated();
new WebUIRouter().start({
  loaders: {
    "activity-page": async () => {
      await import("./src/activity-page/activity-page.js");
      await customElements.whenDefined("activity-page");
    },
    "settings-page": async () => {
      await import("./src/settings-page/settings-page.js");
      await customElements.whenDefined("settings-page");
    },
  },
});
publishHydrated("fast-v3");
