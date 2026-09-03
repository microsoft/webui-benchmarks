// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// `@lit-labs/ssr` installs its own per-render DOM shim around the element
// lifecycle. The global `install-global-dom-shim` entry point is deliberately
// not used: the benchmark loads several product renderers into one process, and
// a global `window`/`document` would leak into peers that legitimately branch
// on their absence to pick their server code path.
import { render } from "@lit-labs/ssr";
import { RenderResultReadable } from "@lit-labs/ssr/lib/render-result-readable.js";
import { Readable } from "node:stream";
import { html } from "lit";
import { matchRoute } from "./routes.mjs";
import "./components/workspace-app.mjs";
import "./components/activity-page.mjs";
import "./components/settings-page.mjs";

function workspace(state, requestPath) {
  return html`<workspace-app
    route="${matchRoute(requestPath)}"
    .state=${state}
  ></workspace-app>`;
}

/**
 * Collects the whole document into one string. `render()` returns a sync
 * iterable of chunks, so the complete-response suite simply drains it.
 */
export function renderTodo(state, requestPath = "/dynamic") {
  let html = "";
  for (const chunk of render(workspace(state, requestPath))) {
    html += chunk;
  }
  return html;
}

/**
 * Lit's native streaming SSR surface: `RenderResultReadable` publishes each
 * chunk as the renderer produces it, and `Readable.toWeb` adapts it to the
 * `ReadableStream` the benchmark transport consumes.
 */
export function renderTodoStream(state, requestPath = "/dynamic") {
  return Readable.toWeb(
    new RenderResultReadable(render(workspace(state, requestPath))),
  );
}
