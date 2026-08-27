// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";
import {
  archiveWorkspaceSelection,
  createClientWorkspaceIntelligence,
  exportWorkspaceRows,
  filterWorkspace,
  resetWorkspaceIntelligence,
  saveWorkspaceView,
  searchWorkspace,
  selectWorkspaceResults,
  selectWorkspaceView,
  setWorkspaceSchedule,
  toggleWorkspaceRow,
} from "../../../../shared/workspace-intelligence-client.mjs";

type WorkspaceModel = Record<string, unknown>;
type WorkspaceState = {
  intelligence: WorkspaceModel;
  todos: Array<Record<string, unknown>>;
};
type WorkspaceReducer = (
  state: () => WorkspaceState,
) => Promise<WorkspaceState>;

function isWorkspaceRow(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  return value !== null
    && typeof value === "object"
    && "id" in value
    && typeof value.id === "string";
}

export class WorkspaceIntelligence extends FASTElement {
  @observable intelligence: WorkspaceModel = {};
  @observable todos: Array<Record<string, unknown>> = [];
  private applyQueue = Promise.resolve();

  setWorkspaceState(
    todos: Array<Record<string, unknown>>,
    intelligence: WorkspaceModel,
  ): void {
    const todosChanged = this.todos !== todos;
    this.todos = todos;
    this.commitIntelligence(
      todosChanged
        ? createClientWorkspaceIntelligence(todos, intelligence)
        : intelligence,
    );
  }

  onSearch(event: Event): void {
    const input = event.currentTarget;
    if (input instanceof HTMLInputElement) {
      this.apply((state) => searchWorkspace(state, input.value));
    }
  }

  onFilter(event: Event): void {
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) {
      const facet = select.dataset.facet;
      if (facet === undefined) {
        throw new Error("Workspace filter is missing its facet");
      }
      this.apply((state) => filterWorkspace(state, facet, select.value));
    }
  }

  onSchedule(event: Event): void {
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) {
      this.apply((state) => setWorkspaceSchedule(state, select.value));
    }
  }

  onClick(event: MouseEvent): boolean {
    const action = event.composedPath().find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return true;
    const actionId = action.dataset.action;
    const view = action.dataset.view;
    const todoId = action.dataset.todoId;
    if (actionId === "workspace-view" && view !== undefined) {
      this.apply((state) => selectWorkspaceView(state, view));
    } else if (actionId === "workspace-row-select" && todoId !== undefined) {
      this.apply((state) => toggleWorkspaceRow(state, todoId));
    } else if (actionId === "workspace-select-all") {
      this.apply(selectWorkspaceResults);
    } else if (actionId === "workspace-archive") {
      this.apply(archiveWorkspaceSelection);
    } else if (actionId === "workspace-save-view") {
      this.apply(saveWorkspaceView);
    } else if (actionId === "workspace-export") {
      this.apply(exportWorkspaceRows);
    } else if (actionId === "workspace-reset") {
      this.apply(resetWorkspaceIntelligence);
    }
    return true;
  }

  private apply(reducer: WorkspaceReducer): void {
    const run = async () => {
      const next = await reducer(() => ({
        intelligence: this.intelligence,
        todos: this.todos,
      }));
      this.commitIntelligence(next.intelligence);
    };
    this.applyQueue = this.applyQueue.then(run, run);
  }

  private commitIntelligence(next: WorkspaceModel): void {
    const currentRows = Array.isArray(this.intelligence.previewRows)
      ? this.intelligence.previewRows.filter(isWorkspaceRow)
      : [];
    if (Array.isArray(next.previewRows)) {
      const currentById = new Map(currentRows.map((row) => [row.id, row]));
      next.previewRows = next.previewRows.map((value) => {
        if (!isWorkspaceRow(value)) return value;
        const current = currentById.get(value.id);
        if (current === undefined) return value;
        Object.assign(current, value);
        return current;
      });
    }
    this.intelligence = next;
    this.$emit("workspace-change", { intelligence: next });
    queueMicrotask(() => this.synchronizeControls(next));
  }

  private synchronizeControls(model: WorkspaceModel): void {
    const root = this.shadowRoot;
    if (root === null) return;

    const search = root.querySelector<HTMLInputElement>(
      '[data-action="workspace-search"]',
    );
    if (search !== null && typeof model.query === "string") {
      search.value = model.query;
    }

    for (
      const select of root.querySelectorAll<HTMLSelectElement>(
        '[data-action="workspace-filter"][data-facet]',
      )
    ) {
      const facet = select.dataset.facet;
      const value = facet === undefined ? undefined : model[facet];
      if (typeof value === "string") select.value = value;
    }

    const schedule = root.querySelector<HTMLSelectElement>(
      '[data-action="workspace-schedule"]',
    );
    if (schedule !== null && typeof model.schedule === "string") {
      schedule.value = model.schedule;
    }

    const selected = new Set(
      Array.isArray(model.selectedIds)
        ? model.selectedIds.filter(isWorkspaceRow).map(({ id }) => id)
        : [],
    );
    for (
      const input of root.querySelectorAll<HTMLInputElement>(
        '[data-action="workspace-row-select"][data-todo-id]',
      )
    ) {
      input.checked = selected.has(input.dataset.todoId ?? "");
    }
  }
}

void WorkspaceIntelligence.define(
  { name: "workspace-intelligence", template: declarativeTemplate() },
  [observerMap()],
);
