// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoFooter } from "../component-styles.mjs";

export class TodoFooter extends LitElement {
  static properties = {
    label: {},
    itemcountlabel: {},
    variantlabel: {},
  };

  static styles = todoFooter;

  constructor() {
    super();
    this.label = "";
    this.itemcountlabel = "";
    this.variantlabel = "";
  }

  render() {
    return html`<footer class="todo-footer">
      <span>${this.label}</span>
      <span>${this.itemcountlabel}</span>
      <span>${this.variantlabel}</span>
    </footer>`;
  }
}

customElements.define("todo-footer", TodoFooter);
