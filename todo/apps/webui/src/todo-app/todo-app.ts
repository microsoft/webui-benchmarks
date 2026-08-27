// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { WebUIElement, observable } from "@microsoft/webui-framework";
import { publishHydrated } from "../../../../shared/hydration.mjs";

import {
  clearCompletedTodos,
  filterTodos,
  selectTodo,
  toggleTodoCompletion,
} from "../../interactions.mjs";

interface TodoItem {
  id: string;
  completed: boolean;
  pending: boolean;
  selected: boolean;
  visible: boolean;
  statusLabel: string;
  selectionLabel: string;
  isHighPriority: boolean;
  overdue: boolean;
  [key: string]: unknown;
}

interface FilterState {
  id: string;
  active: boolean;
  count: number;
  countLabel: string;
  [key: string]: unknown;
}

interface ToolbarState {
  activeFilter: string;
  hasCompleted: boolean;
  filters: FilterState[];
  [key: string]: unknown;
}

interface SummaryState {
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  highPriorityCount: number;
  overdueCount: number;
  [key: string]: unknown;
}

interface SelectionState {
  todoId: string;
  label: string;
  hasSelection: boolean;
}

interface TodoState {
  app: Record<string, unknown>;
  variantLabel: string;
  summary: SummaryState;
  toolbar: ToolbarState;
  selection: SelectionState;
  todos: TodoItem[];
  footer: Record<string, unknown>;
  intelligence: Record<string, unknown>;
}

export class TodoApp extends WebUIElement {
  @observable app: Record<string, unknown> = {};
  @observable variantLabel = "";
  @observable summary: SummaryState = {
    totalCount: 0,
    completedCount: 0,
    pendingCount: 0,
    highPriorityCount: 0,
    overdueCount: 0,
  };
  @observable toolbar: ToolbarState = {
    activeFilter: "all",
    hasCompleted: false,
    filters: [],
  };
  @observable selection: SelectionState = {
    todoId: "",
    label: "",
    hasSelection: false,
  };
  @observable todos: TodoItem[] = [];
  @observable footer: Record<string, unknown> = {};
  @observable intelligence: Record<string, unknown> = {};

  protected override hydratedCallback(): void {
    publishHydrated("webui");
  }

  onClick(event: MouseEvent): void {
    const action = event.composedPath().find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return;
    const actionId = action.dataset.action;
    if (actionId === "filter") {
      const filterId = action.dataset.filter;
      if (filterId !== undefined) {
        this.applyState(filterTodos(this.state(), filterId) as TodoState);
      }
    } else if (actionId === "select") {
      const todoId = action.dataset.todoId;
      if (todoId !== undefined) {
        this.applyState(selectTodo(this.state(), todoId) as TodoState);
      }
    } else if (actionId === "clear-completed") {
      this.applyState(clearCompletedTodos(this.state()) as TodoState);
    } else if (actionId === "toggle-completion") {
      const todoId = action.dataset.todoId;
      if (todoId !== undefined) {
        this.applyState(
          toggleTodoCompletion(this.state(), todoId) as TodoState,
        );
      }
    }
  }

  onWorkspaceChange(
    event: CustomEvent<{ intelligence: Record<string, unknown> }>,
  ): void {
    this.intelligence = event.detail.intelligence;
  }

  private state(): TodoState {
    return {
      app: this.app,
      variantLabel: this.variantLabel,
      summary: this.summary,
      toolbar: this.toolbar,
      selection: this.selection,
      todos: this.todos,
      footer: this.footer,
      intelligence: this.intelligence,
    };
  }

  private applyState(state: TodoState): void {
    this.app = state.app;
    this.variantLabel = state.variantLabel;
    this.summary = state.summary;
    this.toolbar = state.toolbar;
    this.selection = state.selection;
    this.todos = state.todos;
    this.footer = state.footer;
    this.intelligence = state.intelligence;
  }
}

TodoApp.define("todo-app");
