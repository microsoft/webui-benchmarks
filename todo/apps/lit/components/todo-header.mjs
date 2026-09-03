// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoHeader } from "../component-styles.mjs";

export class TodoHeader extends LitElement {
  static properties = {
    eyebrow: {},
    title: {},
    subtitle: {},
    description: {},
    variantlabel: {},
  };

  static styles = todoHeader;

  constructor() {
    super();
    this.eyebrow = "";
    this.title = "";
    this.subtitle = "";
    this.description = "";
    this.variantlabel = "";
  }

  render() {
    return html`<header class="todo-header">
      <div>
        <p class="todo-header__eyebrow">${this.eyebrow}</p>
        <h1 id="todo-app-title">${this.title}</h1>
        <p><strong>${this.subtitle}</strong></p>
        <p>${this.description}</p>
      </div>
      <strong>${this.variantlabel}</strong>
    </header>`;
  }
}

customElements.define("todo-header", TodoHeader);
