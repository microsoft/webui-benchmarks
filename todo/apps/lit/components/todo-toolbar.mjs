// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { todoToolbar } from "../component-styles.mjs";
import "./todo-filter.mjs";
import "./todo-button.mjs";

export class TodoToolbar extends LitElement {
  static properties = {
    filters: { type: Array },
    selectionlabel: {},
    clearcompletedlabel: {},
    hascompleted: { type: Boolean },
  };

  static styles = todoToolbar;

  constructor() {
    super();
    this.filters = [];
    this.selectionlabel = "";
    this.clearcompletedlabel = "";
    this.hascompleted = false;
  }

  render() {
    return html`<section aria-label="Todo controls" class="todo-toolbar">
      <div aria-label="Filter todos" class="todo-toolbar__filters" role="group">
        ${repeat(
          this.filters,
          (filter) => filter.id,
          (filter) => html`<todo-filter
            ?active=${filter.active}
            countlabel="${filter.countLabel}"
            filterid="${filter.id}"
            label="${filter.label}"
            data-component="todo-filter"
          ></todo-filter>`,
        )}
      </div>
      <span aria-live="polite" class="todo-toolbar__selection">
        ${this.selectionlabel}
      </span>
      <todo-button
        clearcompletedlabel="${this.clearcompletedlabel}"
        ?hascompleted=${this.hascompleted}
        data-component="todo-button"
      ></todo-button>
    </section>`;
  }
}

customElements.define("todo-toolbar", TodoToolbar);
