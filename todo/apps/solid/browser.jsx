// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hydrate } from "solid-js/web";
import { WorkspaceApp } from "./components/workspace-app.jsx";

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

function readInitialState() {
  const script = document.querySelector("script[data-todo-app-state]");
  if (script === null) {
    throw new Error("The Solid todo app is missing its serialized state");
  }
  return JSON.parse(script.textContent ?? "");
}

export function startTodoApp(
  target = document.querySelector("#todo-browser-root") ?? document.body,
  state = readInitialState(),
) {
  if (customElements.get("todo-badge") === undefined) {
    customElements.define("todo-badge", TodoBadgeElement);
  }
  return hydrate(() => <WorkspaceApp state={state} />, target);
}

if (document.querySelector("script[data-todo-app-state]") !== null) {
  startTodoApp();
}
