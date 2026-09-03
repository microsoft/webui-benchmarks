// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoCheckbox } from "../component-styles.mjs";

export class TodoCheckbox extends LitElement {
  static properties = {
    statuslabel: {},
    title: {},
    completed: { type: Boolean },
    todoid: {},
  };

  static styles = todoCheckbox;

  constructor() {
    super();
    this.statuslabel = "";
    this.title = "";
    this.completed = false;
    this.todoid = "";
  }

  render() {
    return html`<input
      aria-label="${this.statuslabel}: ${this.title}"
      ?checked=${this.completed}
      class="todo-checkbox"
      data-action="toggle-completion"
      data-todo-id="${this.todoid}"
      type="checkbox"
    />`;
  }
}

customElements.define("todo-checkbox", TodoCheckbox);
