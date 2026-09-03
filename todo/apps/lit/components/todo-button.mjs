// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoButton } from "../component-styles.mjs";

export class TodoButton extends LitElement {
  static properties = {
    todoid: {},
    todotitle: {},
    selected: { type: Boolean },
    clearcompletedlabel: {},
    hascompleted: { type: Boolean },
  };

  static styles = todoButton;

  constructor() {
    super();
    this.todoid = "";
    this.todotitle = "";
    this.selected = false;
    this.clearcompletedlabel = "";
    this.hascompleted = false;
  }

  render() {
    return html`${this.todoid
      ? html`<button
          aria-label="Select ${this.todotitle}"
          aria-pressed="${this.selected}"
          class="todo-button"
          data-action="select"
          data-todo-id="${this.todoid}"
          type="button"
        >
          Select
        </button>`
      : ""}${this.clearcompletedlabel
      ? html`<button
          aria-label="${this.clearcompletedlabel}"
          class="todo-button"
          data-action="clear-completed"
          ?disabled=${!this.hascompleted}
          type="button"
        >
          ${this.clearcompletedlabel}
        </button>`
      : ""}`;
  }
}

customElements.define("todo-button", TodoButton);
