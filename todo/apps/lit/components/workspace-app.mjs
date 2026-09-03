// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { shared } from "../component-styles.mjs";
import { matchRoute } from "../routes.mjs";
import "./todo-app.mjs";

/**
 * The routed workspace shell. It renders the navigation chrome that every
 * product shares and swaps the active page beneath it.
 *
 * The shell keeps `route` as a plain reactive property rather than reading
 * `location` directly, so one component serves both passes: the server sets it
 * from the request path, and in the browser `@lit-labs/router` sets it on every
 * client navigation. `client.mjs` installs that router and preloads the two
 * lazily imported route modules.
 */
export class WorkspaceApp extends LitElement {
  static properties = {
    route: {},
    state: { type: Object },
  };

  static styles = shared;

  #page = createRef();

  constructor() {
    super();
    this.route = "work";
    this.state = null;
  }

  /** Navigates the shell, used by the client router's route callbacks. */
  goto(pathname) {
    this.route = matchRoute(pathname);
  }

  /** The currently rendered page element, once it has been created. */
  get page() {
    return this.#page.value;
  }

  #renderPage() {
    const state = this.state;
    if (state === null) {
      return "";
    }
    if (this.route === "activity") {
      return html`<activity-page
        ${ref(this.#page)}
        title="${state.activity.title ?? ""}"
        description="${state.activity.description ?? ""}"
        .filters=${state.activity.filters}
        .events=${state.activity.events}
        .unreadCount=${state.activity.unreadCount}
        unreadLabel="${state.activity.unreadLabel ?? ""}"
      ></activity-page>`;
    }
    if (this.route === "settings") {
      return html`<settings-page
        ${ref(this.#page)}
        title="${state.settings.title ?? ""}"
        description="${state.settings.description ?? ""}"
        density="${state.settings.density}"
        .densityOptions=${state.settings.densityOptions}
        ?dirty=${state.settings.dirty}
        ?saved=${state.settings.saved}
        statusLabel="${state.settings.statusLabel ?? ""}"
        .toggles=${state.settings.toggles}
      ></settings-page>`;
    }
    return html`<todo-app
      ${ref(this.#page)}
      .app=${state.app}
      variantLabel="${state.variantLabel}"
      .summary=${state.summary}
      .toolbar=${state.toolbar}
      .selection=${state.selection}
      .todos=${state.todos}
      .footer=${state.footer}
      .intelligence=${state.intelligence}
    ></todo-app>`;
  }

  render() {
    return html`<div class="workspace-shell">
      <header class="workspace-nav">
        <a class="workspace-brand" href="/dynamic">
          <span class="workspace-brand__mark" aria-hidden="true">W</span>
          <span>
            <strong>Workstream</strong>
            <small>Migration benchmark</small>
          </span>
        </a>
        <nav aria-label="Workspace">
          <a data-route-link="work" href="/dynamic">Work queue</a>
          <a data-route-link="activity" href="/activity">Activity</a>
          <a data-route-link="settings" href="/settings">Settings</a>
        </nav>
      </header>
      ${this.#renderPage()}
    </div>`;
  }
}

customElements.define("workspace-app", WorkspaceApp);
