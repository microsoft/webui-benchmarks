// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoItem } from "../component-styles.mjs";
import "./todo-badge.mjs";
import "./todo-button.mjs";
import "./todo-checkbox.mjs";
import "./todo-tag-list.mjs";

/**
 * One row of the work queue. The FAST row splits every branch into its own
 * `todo-badge` host so the benchmark exercises a real per-item component tree
 * rather than a flat string; this port keeps each branch site intact.
 */
export class TodoItem extends LitElement {
  static properties = {
    todo: { type: Object },
  };

  static styles = todoItem;

  constructor() {
    super();
    this.todo = {};
  }

  #badge(branch, label) {
    return html`<todo-badge
      class="todo-badge"
      data-branch="${branch}"
      data-component="todo-badge"
    >${label}</todo-badge>`;
  }

  render() {
    const todo = this.todo;
    const badges = [
      todo.completed ? this.#badge("completed", todo.statusLabel) : "",
      todo.pending ? this.#badge("pending", todo.statusLabel) : "",
      todo.isHighPriority ? this.#badge("high-priority", todo.priorityLabel) : "",
      todo.isMediumPriority
        ? this.#badge("medium-priority", todo.priorityLabel)
        : "",
      todo.overdue ? this.#badge("overdue", todo.dueLabel) : "",
      todo.dueToday ? this.#badge("due-today", todo.dueLabel) : "",
      todo.blocked ? this.#badge("blocked", todo.blockedLabel) : "",
      todo.recurring ? this.#badge("recurring", todo.recurringLabel) : "",
      todo.assigned ? this.#badge("assigned", todo.assigneeLabel) : "",
      todo.hasTags ? this.#badge("has-tags", todo.tagCountLabel) : "",
      todo.hasSubtasks
        ? this.#badge("has-subtasks", todo.subtaskProgressLabel)
        : "",
      todo.selected ? this.#badge("selected", todo.selectionLabel) : "",
    ];
    return html`<li
      aria-selected="${todo.selected}"
      class="todo-item"
      ?data-selected=${todo.selected}
      data-todo-id="${todo.id}"
      role="option"
      tabindex="0"
    >
      <todo-checkbox
        ?completed=${todo.completed}
        statuslabel="${todo.statusLabel}"
        title="${todo.title}"
        todoid="${todo.id}"
        data-component="todo-checkbox"
      ></todo-checkbox>
      <div class="todo-item__content">
        <strong class="todo-item__title">${todo.title}</strong>
        <span class="todo-item__description">${todo.description}</span>
        <div aria-label="Todo attributes" class="todo-item__badges">
          ${badges}
        </div>
        <todo-tag-list
          tagcountlabel="${todo.tagCountLabel}"
          .tags=${todo.tags ?? []}
          data-component="todo-tag-list"
        ></todo-tag-list>
      </div>
      <div class="todo-item__meta">
        <span>${todo.priorityLabel}</span>
        <span>${todo.dueLabel}</span>
        <span>${todo.assigneeLabel}</span>
        <span>${todo.subtaskCountLabel}</span>
        <todo-button
          ?selected=${todo.selected}
          todotitle="${todo.title}"
          todoid="${todo.id}"
          data-component="todo-button"
        ></todo-button>
      </div>
    </li>`;
  }
}

customElements.define("todo-item", TodoItem);
