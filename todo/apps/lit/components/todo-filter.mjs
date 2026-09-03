// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoFilter } from "../component-styles.mjs";

/**
 * Reference leaf component for this row: scalar reactive properties named
 * exactly like the FAST V3 row's `observerMap()` inputs, a component-scoped
 * stylesheet, and the shared `data-action` interaction hooks in the shadow
 * root. `todo-app` delegates the click, so this element carries no listener.
 */
export class TodoFilter extends LitElement {
  static properties = {
    active: { type: Boolean },
    countlabel: {},
    filterid: {},
    label: {},
  };

  static styles = todoFilter;

  constructor() {
    super();
    this.active = false;
    this.countlabel = "";
    this.filterid = "";
    this.label = "";
  }

  render() {
    return html`<button
      aria-label="${this.label}: ${this.countlabel}"
      aria-pressed="${this.active}"
      class="todo-filter"
      data-action="filter"
      ?data-active=${this.active}
      data-filter="${this.filterid}"
      type="button"
    >
      <span>${this.label}</span>
      <span class="todo-filter__count">${this.countlabel}</span>
    </button>`;
  }
}

customElements.define("todo-filter", TodoFilter);
