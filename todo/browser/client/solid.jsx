// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { startTodoApp } from "../../apps/solid/browser.jsx";
import {
  benchmarkTarget,
  initialState,
  publishFailure,
  publishReady,
} from "./ready.mjs";

class TodoBadgeElement extends HTMLElement {
  get dataBranch() {
    return this.getAttribute("data-branch");
  }

  set dataBranch(value) {
    if (value === null || value === undefined) {
      this.removeAttribute("data-branch");
    } else {
      this.setAttribute("data-branch", value);
    }
  }
}

if (customElements.get("todo-badge") === undefined) {
  customElements.define("todo-badge", TodoBadgeElement);
}

const startedAt = performance.now();
try {
  await startTodoApp(benchmarkTarget(), initialState());
  await publishReady({
    clientMode: "hydrate",
    hydrationStatus: "supported",
    startedAt,
  });
} catch (error) {
  publishFailure(error, "hydrate");
  throw error;
}
