// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { html } from "lit";
import { matchRoute } from "./routes.mjs";

export function workspace(state, requestPath) {
  return html`<workspace-app
    route="${matchRoute(requestPath)}"
    .state=${state}
  ></workspace-app>`;
}
