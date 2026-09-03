// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Lit's hydration support must be installed before any `LitElement` subclass is
// defined, so this import stays first and the component modules load after it.
import "@lit-labs/ssr-client/lit-element-hydrate-support.js";
import { Router } from "@lit-labs/router";
import { html } from "lit";
import { publishHydrated } from "../../shared/hydration.mjs";
import { WorkspaceApp } from "./components/workspace-app.mjs";
import "./components/todo-app.mjs";

export { WorkspaceApp };

/**
 * Installs `@lit-labs/router` on the server-rendered shell. The router owns
 * link interception, history, and the lazy route imports; each route's `enter`
 * hook loads its page module before the shell renders that route, so the two
 * secondary pages stay out of the initial bundle exactly like every other
 * product's code-split router.
 */
function installRouter(shell) {
  const enterActivity = async () => {
    await import("./components/activity-page.mjs");
    return true;
  };
  const enterSettings = async () => {
    await import("./components/settings-page.mjs");
    return true;
  };
  const work = { render: () => html`` };
  return new Router(shell, [
    { ...work, path: "/" },
    { ...work, path: "/dynamic" },
    { ...work, path: "/cached" },
    { enter: enterActivity, path: "/activity", render: () => html`` },
    { enter: enterSettings, path: "/settings", render: () => html`` },
  ]);
}

/**
 * Activates the server-rendered markup in `target`. Lit adopts the existing
 * declarative shadow roots rather than recreating them: the shell element is
 * already in the document, so handing it its state and clearing
 * `defer-hydration` resumes the very same component tree the server produced.
 */
export async function hydrateTodo(target, state) {
  const shell = target.querySelector("workspace-app")
    ?? target.closest?.("workspace-app")
    ?? target;
  shell.state = state;
  await customElements.whenDefined("workspace-app");
  const router = installRouter(shell);
  const navigate = () => shell.goto(window.location.pathname);
  const originalGoto = router.goto.bind(router);
  router.goto = async (pathname) => {
    await originalGoto(pathname);
    shell.goto(pathname);
  };
  navigate();
  shell.removeAttribute("defer-hydration");
  await shell.updateComplete;
  publishHydrated("lit");
  return shell;
}

export default hydrateTodo;
