// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { todoList } from "../component-styles.mjs";
import "./todo-item.mjs";

/**
 * Reference list component for this row: keyed `repeat()` over the state
 * array, so hydration and every later interaction reuse the same DOM nodes per
 * todo id instead of re-creating the list. Object payloads are passed with
 * Lit's `.property` binding; only scalars become attributes.
 */
export class TodoList extends LitElement {
  static properties = {
    rendertodos: { type: Array },
  };

  static styles = todoList;

  constructor() {
    super();
    this.rendertodos = [];
  }

  render() {
    const todos = this.rendertodos.filter((todo) => todo.visible);
    return html`<ul aria-label="Todo items" class="todo-list" role="listbox">
      ${repeat(
        todos,
        (todo) => todo.id,
        (todo) => html`<todo-item .todo=${todo} data-component="todo-item"></todo-item>`,
      )}
    </ul>`;
  }
}

customElements.define("todo-list", TodoList);
