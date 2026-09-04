// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { ref, createRef } from "lit/directives/ref.js";
import { todoApp } from "../component-styles.mjs";
import {
  clearCompletedTodos,
  filterTodos,
  selectTodo,
  toggleTodoCompletion,
} from "../client-interactions.mjs";
import "./todo-footer.mjs";
import "./todo-header.mjs";
import "./todo-list.mjs";
import "./todo-summary.mjs";
import "./todo-toolbar.mjs";
import "./workspace-intelligence.mjs";

/**
 * The work queue page. Like the FAST V3 row, this element owns delegated click
 * handling for the whole page and reduces through the shared interaction
 * module, so every product applies byte-identical state transitions.
 */
export class TodoApp extends LitElement {
  static properties = {
    app: { type: Object },
    variantLabel: {},
    summary: { type: Object },
    toolbar: { type: Object },
    selection: { type: Object },
    todos: { type: Array },
    footer: { type: Object },
    intelligence: { type: Object },
  };

  static styles = todoApp;

  #workspaceIntelligence = createRef();

  #workspaceModel;

  constructor() {
    super();
    this.app = {};
    this.variantLabel = "";
    this.summary = {
      totalCount: 0,
      completedCount: 0,
      pendingCount: 0,
      highPriorityCount: 0,
      overdueCount: 0,
    };
    this.toolbar = { activeFilter: "all", hasCompleted: false, filters: [] };
    this.selection = { todoId: "", label: "", hasSelection: false };
    this.todos = [];
    this.footer = {};
    this.intelligence = {};
  }

  setState(state) {
    this.applyState(state);
  }

  applyState(state) {
    this.app = state.app;
    this.variantLabel = state.variantLabel;
    this.summary = state.summary;
    this.toolbar = state.toolbar;
    this.selection = state.selection;
    this.todos = state.todos;
    this.footer = state.footer;
    this.#workspaceModel = state.intelligence;
    this.intelligence = state.intelligence;
    const workspace = this.#workspaceIntelligence.value
      ?? this.renderRoot.querySelector("workspace-intelligence");
    if (workspace !== null && workspace !== undefined) {
      workspace.setWorkspaceState(state.todos, state.intelligence);
    }
  }

  #state() {
    return {
      app: this.app,
      variantLabel: this.variantLabel,
      summary: this.summary,
      toolbar: this.toolbar,
      selection: this.selection,
      todos: this.todos,
      footer: this.footer,
      intelligence: this.#workspaceModel ?? this.intelligence,
    };
  }

  onClick = (event) => {
    const action = event.composedPath().find(
      (candidate) =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return;
    const actionId = action.dataset.action;
    if (actionId === "filter") {
      const filterId = action.dataset.filter;
      if (filterId !== undefined) {
        this.applyState(filterTodos(this.#state(), filterId));
      }
    } else if (actionId === "select") {
      const todoId = action.dataset.todoId;
      if (todoId !== undefined) {
        this.applyState(selectTodo(this.#state(), todoId));
      }
    } else if (actionId === "clear-completed") {
      this.applyState(clearCompletedTodos(this.#state()));
    } else if (actionId === "toggle-completion") {
      const todoId = action.dataset.todoId;
      if (todoId !== undefined) {
        this.applyState(toggleTodoCompletion(this.#state(), todoId));
      }
    }
  };

  onWorkspaceChange = (event) => {
    this.#workspaceModel = event.detail.intelligence;
    this.intelligence = event.detail.intelligence;
  };

  render() {
    return html`<main
      aria-labelledby="todo-app-title"
      class="todo-app"
      data-route-page="work"
      @click=${this.onClick}
    >
      <todo-header
        description="${this.app.description ?? ""}"
        eyebrow="${this.app.eyebrow ?? ""}"
        subtitle="${this.app.subtitle ?? ""}"
        title="${this.app.title ?? ""}"
        variantlabel="${this.variantLabel}"
        data-component="todo-header"
      ></todo-header>
      <todo-summary
        completedcount="${this.summary.completedCount}"
        completedlabel="${this.summary.completedLabel ?? ""}"
        highprioritycount="${this.summary.highPriorityCount}"
        highprioritylabel="${this.summary.highPriorityLabel ?? ""}"
        overduecount="${this.summary.overdueCount}"
        overduelabel="${this.summary.overdueLabel ?? ""}"
        pendingcount="${this.summary.pendingCount}"
        pendinglabel="${this.summary.pendingLabel ?? ""}"
        totalcount="${this.summary.totalCount}"
        totallabel="${this.summary.totalLabel ?? ""}"
        data-component="todo-summary"
      ></todo-summary>
      <workspace-intelligence
        ${ref(this.#workspaceIntelligence)}
        .intelligence=${this.intelligence}
        .todos=${this.todos}
        @workspace-change=${this.onWorkspaceChange}
        data-component="workspace-intelligence"
      ></workspace-intelligence>
      <todo-toolbar
        clearcompletedlabel="${this.toolbar.clearCompletedLabel ?? ""}"
        .filters=${this.toolbar.filters ?? []}
        ?hascompleted=${this.toolbar.hasCompleted}
        selectionlabel="${this.selection.label}"
        data-component="todo-toolbar"
      ></todo-toolbar>
      <todo-list
        .rendertodos=${this.todos}
        data-component="todo-list"
      ></todo-list>
      <todo-footer
        itemcountlabel="${this.footer.itemCountLabel ?? ""}"
        label="${this.footer.label ?? ""}"
        variantlabel="${this.footer.variantLabel ?? ""}"
        data-component="todo-footer"
      ></todo-footer>
    </main>`;
  }
}

customElements.define("todo-app", TodoApp);
