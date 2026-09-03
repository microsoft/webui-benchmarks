// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { todoTagList } from "../component-styles.mjs";

export class TodoTagList extends LitElement {
  static properties = {
    tagcountlabel: {},
    tags: { type: Array },
  };

  static styles = todoTagList;

  constructor() {
    super();
    this.tagcountlabel = "";
    this.tags = [];
  }

  render() {
    return html`<div aria-label="${this.tagcountlabel}" class="todo-tag-list">
      ${repeat(
        this.tags,
        (tag) => tag.id,
        (tag) => html`<span
          class="todo-tag"
          data-tag-id="${tag.id}"
          data-tone="${tag.tone}"
        >${tag.label}</span>`,
      )}
    </div>`;
  }
}

customElements.define("todo-tag-list", TodoTagList);
