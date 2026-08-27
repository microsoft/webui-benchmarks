// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { WebUIElement, observable } from "@microsoft/webui-framework";
import {
  archiveWorkspaceSelection,
  exportWorkspaceRows,
  filterWorkspace,
  resetWorkspaceIntelligence,
  saveWorkspaceView,
  searchWorkspace,
  selectWorkspaceResults,
  selectWorkspaceView,
  setWorkspaceSchedule,
  toggleWorkspaceRow,
} from "../../../../shared/workspace-intelligence.mjs";

type WorkspaceModel = Record<string, unknown>;

export class WorkspaceIntelligence extends WebUIElement {
  @observable intelligence: WorkspaceModel = {};
  @observable todos: Array<Record<string, unknown>> = [];

  onSearch(event: Event): void {
    const input = event.currentTarget;
    if (input instanceof HTMLInputElement) {
      this.apply((state) => searchWorkspace(state, input.value));
    }
  }

  onFilter(facet: string, event: Event): void {
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) {
      this.apply((state) => filterWorkspace(state, facet, select.value));
    }
  }

  onSchedule(event: Event): void {
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) {
      this.apply((state) => setWorkspaceSchedule(state, select.value));
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
    const { todoId, view } = action.dataset;
    if (actionId === "workspace-view" && view !== undefined) {
      this.apply((state) => selectWorkspaceView(state, view));
    } else if (actionId === "workspace-row-select"
      && todoId !== undefined) {
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
  }

  private apply(
    reducer: (state: {
      intelligence: WorkspaceModel;
      todos: Array<Record<string, unknown>>;
    }) => {
      intelligence: WorkspaceModel;
      todos: Array<Record<string, unknown>>;
    },
  ): void {
    this.intelligence = reducer({
      intelligence: this.intelligence,
      todos: this.todos,
    }).intelligence;
    this.$emit("workspace-change", { intelligence: this.intelligence });
  }
}

WorkspaceIntelligence.define("workspace-intelligence");
