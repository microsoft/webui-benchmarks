// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";
import type { RouteLoaderContext } from "@microsoft/webui-delivery/router.js";

import {
  clearCompletedTodos,
  filterTodos,
  selectTodo,
  toggleTodoCompletion,
} from "../../client-interactions.mjs";

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

interface WorkspaceIntelligenceElement extends HTMLElement {
  setWorkspaceState(
    todos: TodoItem[],
    intelligence: Record<string, unknown>,
  ): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTodoItem(value: unknown): value is TodoItem {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.completed === "boolean"
    && typeof value.pending === "boolean"
    && typeof value.selected === "boolean"
    && typeof value.visible === "boolean"
    && typeof value.statusLabel === "string"
    && typeof value.selectionLabel === "string"
    && typeof value.isHighPriority === "boolean"
    && typeof value.overdue === "boolean";
}

function isTodoState(value: unknown): value is TodoState {
  return isRecord(value)
    && isRecord(value.app)
    && isRecord(value.summary)
    && isRecord(value.toolbar)
    && Array.isArray(value.toolbar.filters)
    && isRecord(value.selection)
    && Array.isArray(value.todos)
    && value.todos.every(isTodoItem)
    && isRecord(value.footer)
    && typeof value.variantLabel === "string";
}

function readInitialState(): TodoState | null {
  const data = document.querySelector("#webui-data");
  if (!(data instanceof HTMLScriptElement)) {
    return null;
  }
  const payload: unknown = JSON.parse(data.textContent ?? "");
  if (!isRecord(payload) || !isTodoState(payload.state)) {
    throw new Error("The FAST todo application hydration state is invalid");
  }
  return payload.state;
}

export class TodoApp extends FASTElement {
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
  workspaceIntelligence!: WorkspaceIntelligenceElement;
  private workspaceModel: Record<string, unknown> = {};

  static async loader({ signal }: RouteLoaderContext): Promise<TodoState> {
    const response = await fetch("/__bench/route-state", { signal });
    if (!response.ok) {
      throw new Error(`Route state returned HTTP ${response.status}`);
    }
    const state: unknown = await response.json();
    if (
      state === null
      || typeof state !== "object"
      || !("work" in state)
      || !isTodoState(state.work)
    ) {
      throw new TypeError("Route state is missing work");
    }
    return state.work;
  }

  connectedCallback(): void {
    const initialState = readInitialState();
    if (initialState !== null) {
      this.applyState(initialState);
    }
    super.connectedCallback();
  }

  setState(state: Record<string, unknown>): void {
    if (isTodoState(state)) {
      this.applyState(state);
    }
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
    this.workspaceModel = event.detail.intelligence;
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
      intelligence: this.workspaceModel,
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
    this.workspaceModel = state.intelligence;
    if (this.workspaceIntelligence === undefined) {
      this.intelligence = state.intelligence;
    } else {
      this.workspaceIntelligence.setWorkspaceState(
        state.todos,
        state.intelligence,
      );
    }
  }
}

void TodoApp.define(
  { name: "todo-app", template: declarativeTemplate() },
  [observerMap()],
);
