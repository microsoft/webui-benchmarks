// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { shared } from "../component-styles.mjs";
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
} from "../../../shared/workspace-intelligence-client.mjs";

function isWorkspaceRow(value) {
  return value !== null
    && typeof value === "object"
    && "id" in value
    && typeof value.id === "string";
}

export class WorkspaceIntelligence extends LitElement {
  static properties = {
    intelligence: { type: Object },
    todos: { type: Array },
  };

  static styles = shared;

  constructor() {
    super();
    this.intelligence = {};
    this.todos = [];
    this.applyQueue = Promise.resolve();
  }

  setWorkspaceState(todos, intelligence) {
    const todosChanged = this.todos !== todos;
    this.todos = todos;
    this.commitIntelligence(
      todosChanged
        ? createClientWorkspaceIntelligence(todos, intelligence)
        : intelligence,
    );
  }

  onSearch = (event) => {
    const input = event.currentTarget;
    if (input instanceof HTMLInputElement) {
      this.apply((state) => searchWorkspace(state, input.value));
    }
  };

  onFilter = (event) => {
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) {
      const facet = select.dataset.facet;
      if (facet === undefined) {
        throw new Error("Workspace filter is missing its facet");
      }
      this.apply((state) => filterWorkspace(state, facet, select.value));
    }
  };

  onSchedule = (event) => {
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) {
      this.apply((state) => setWorkspaceSchedule(state, select.value));
    }
  };

  onClick = (event) => {
    const action = event.composedPath().find(
      (candidate) =>
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
  };

  apply(reducer) {
    const run = async () => {
      const next = await reducer(() => ({
        intelligence: this.intelligence,
        todos: this.todos,
      }));
      this.commitIntelligence(next.intelligence);
    };
    this.applyQueue = this.applyQueue.then(run, run);
  }

  commitIntelligence(next) {
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
    this.dispatchEvent(
      new CustomEvent("workspace-change", {
        bubbles: true,
        composed: true,
        detail: { intelligence: next },
      }),
    );
  }

  updated() {
    const root = this.renderRoot;
    if (root === null || root === undefined) return;
    const model = this.intelligence;

    const search = root.querySelector('[data-action="workspace-search"]');
    if (search !== null && typeof model.query === "string") {
      search.value = model.query;
    }

    for (
      const select of root.querySelectorAll(
        '[data-action="workspace-filter"][data-facet]',
      )
    ) {
      const facet = select.dataset.facet;
      const value = facet === undefined ? undefined : model[facet];
      if (typeof value === "string") select.value = value;
    }

    const schedule = root.querySelector('[data-action="workspace-schedule"]');
    if (schedule !== null && typeof model.schedule === "string") {
      schedule.value = model.schedule;
    }

    const selected = new Set(
      Array.isArray(model.selectedIds)
        ? model.selectedIds.filter(isWorkspaceRow).map(({ id }) => id)
        : [],
    );
    for (
      const input of root.querySelectorAll(
        '[data-action="workspace-row-select"][data-todo-id]',
      )
    ) {
      input.checked = selected.has(input.dataset.todoId ?? "");
    }
  }

  render() {
    const intelligence = this.intelligence;
    const analytics = intelligence.analytics ?? {};
    const schedulePreview = intelligence.schedulePreview ?? {};
    return html`<section
      class="workspace-intelligence"
      data-archived-count="${intelligence.archivedCount}"
      data-export-rows="${intelligence.exportRows}"
      data-result-count="${intelligence.resultCount}"
      data-saved-view-count="${intelligence.savedViewCount}"
      data-selected-count="${intelligence.selectedCount}"
      data-workspace-schedule="${intelligence.schedule}"
      data-workspace-view="${intelligence.view}"
      @click=${this.onClick}
    >
      <header class="workspace-intelligence__header">
        <div>
          <h2>Workspace intelligence</h2>
          <p>Search, segment, compare, and automate the complete work queue.</p>
        </div>
        <output class="workspace-intelligence__result">
          ${intelligence.resultLabel}
        </output>
      </header>
      <div class="workspace-intelligence__filters">
        <label class="workspace-search">
          <span>Search work</span>
          <input
            data-action="workspace-search"
            placeholder="Title, owner, tag, status…"
            type="search"
            .value=${intelligence.query ?? ""}
            value="${intelligence.query ?? ""}"
            @input=${this.onSearch}
          />
        </label>
        <label>
          <span>Status</span>
          <select data-action="workspace-filter" data-facet="status" @change=${this.onFilter}>
            ${repeat(
              intelligence.statusOptions ?? [],
              (option) => option.id,
              (option) => html`<option ?selected=${option.active} value="${option.id}">${option.label}</option>`,
            )}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select data-action="workspace-filter" data-facet="priority" @change=${this.onFilter}>
            ${repeat(
              intelligence.priorityOptions ?? [],
              (option) => option.id,
              (option) => html`<option ?selected=${option.active} value="${option.id}">${option.label}</option>`,
            )}
          </select>
        </label>
        <label>
          <span>Assignment</span>
          <select data-action="workspace-filter" data-facet="assignment" @change=${this.onFilter}>
            ${repeat(
              intelligence.assignmentOptions ?? [],
              (option) => option.id,
              (option) => html`<option ?selected=${option.active} value="${option.id}">${option.label}</option>`,
            )}
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select data-action="workspace-filter" data-facet="sort" @change=${this.onFilter}>
            ${repeat(
              intelligence.sortOptions ?? [],
              (option) => option.id,
              (option) => html`<option ?selected=${option.active} value="${option.id}">${option.label}</option>`,
            )}
          </select>
        </label>
      </div>
      <div class="workspace-intelligence__commandbar">
        <div class="workspace-view-switch" role="group" aria-label="Work view">
          ${repeat(
            intelligence.viewOptions ?? [],
            (option) => option.id,
            (option) => html`<button
              aria-pressed="${option.active}"
              data-action="workspace-view"
              data-view="${option.id}"
              type="button"
            >${option.label}</button>`,
          )}
        </div>
        <div class="workspace-intelligence__actions">
          <button data-action="workspace-select-all" type="button">Select preview</button>
          <button data-action="workspace-archive" ?disabled=${intelligence.selectedCount == 0} type="button">Archive selected</button>
          <button data-action="workspace-save-view" type="button">Save view</button>
          <button data-action="workspace-export" type="button">Export CSV</button>
          <button data-action="workspace-reset" type="button">Reset</button>
        </div>
      </div>
      <div class="workspace-intelligence__status" aria-live="polite">
        <span>${intelligence.selectedLabel}</span>
        <span>${intelligence.savedViewCount} saved views</span>
        <span>${intelligence.archivedCount} archived</span>
        <span>${intelligence.exportGeneratedLabel}</span>
        <span>${intelligence.validationMessage}</span>
      </div>
      ${intelligence.view === "table"
        ? html`<div class="workspace-table-wrap" data-workspace-panel="table">
            <div class="workspace-table" role="table">
              <div class="workspace-table__head" role="rowgroup">
                <div class="workspace-table__row" role="row">
                  <span class="workspace-table__cell" role="columnheader">Select</span>
                  <span class="workspace-table__cell" role="columnheader">Item</span>
                  <span class="workspace-table__cell" role="columnheader">Status</span>
                  <span class="workspace-table__cell" role="columnheader">Priority</span>
                  <span class="workspace-table__cell" role="columnheader">Owner</span>
                  <span class="workspace-table__cell" role="columnheader">Due</span>
                  <span class="workspace-table__cell" role="columnheader">Tags</span>
                </div>
              </div>
              <div class="workspace-table__body" role="rowgroup">
                ${repeat(
                  intelligence.previewRows ?? [],
                  (row) => row.id,
                  (row) => html`<div
                    class="workspace-table__row"
                    data-assignment="${row.assignment}"
                    data-priority="${row.priority}"
                    data-status="${row.status}"
                    data-workspace-row="${row.id}"
                    role="row"
                  >
                    <span class="workspace-table__cell" role="cell"><input aria-label="Select ${row.id}" ?checked=${row.bulkSelected} data-action="workspace-row-select" data-todo-id="${row.id}" type="checkbox" /></span>
                    <span class="workspace-table__cell workspace-table__item" role="rowheader"><span>${row.id}</span><strong>${row.title}</strong></span>
                    <span class="workspace-table__cell" role="cell">${row.statusLabel}</span>
                    <span class="workspace-table__cell" role="cell">${row.priorityLabel}</span>
                    <span class="workspace-table__cell" role="cell">${row.owner}</span>
                    <span class="workspace-table__cell" role="cell">${row.dueLabel}</span>
                    <span class="workspace-table__cell" role="cell">${row.tagLabel}</span>
                  </div>`,
                )}
              </div>
            </div>
          </div>`
        : ""}
      ${intelligence.view === "board"
        ? html`<div class="workspace-board" data-workspace-panel="board">
            ${repeat(
              intelligence.boardColumns ?? [],
              (column) => column.id,
              (column) => html`<section data-priority="${column.id}">
                <header><h3>${column.label}</h3><span>${column.count}</span></header>
                <ol>
                  ${repeat(
                    column.items ?? [],
                    (row) => row.id,
                    (row) => html`<li><strong>${row.title}</strong><span>${row.owner}</span><small>${row.statusLabel} · ${row.dueLabel}</small></li>`,
                  )}
                </ol>
              </section>`,
            )}
          </div>`
        : ""}
      ${intelligence.view === "insights"
        ? html`<div class="workspace-insights" data-workspace-panel="insights">
            <section class="workspace-chart">
              <h3>Queue momentum</h3>
              <svg aria-label="Work queue trend" role="img" viewBox="0 0 300 120">
                <path class="workspace-chart__area" d="${analytics.areaPath}"></path>
                <path class="workspace-chart__line" d="${analytics.trendPath}"></path>
              </svg>
            </section>
            <section class="workspace-priority-bars">
              <h3>Priority distribution</h3>
              ${repeat(
                analytics.priorityBars ?? [],
                (bar) => bar.id,
                (bar) => html`<label><span>${bar.label}</span><progress max="100" value="${bar.percent}"></progress><strong>${bar.count}</strong></label>`,
              )}
            </section>
            <section class="workspace-donut">
              <h3>Status mix</h3>
              <svg aria-label="Pending and completed work" role="img" viewBox="0 0 144 124">
                <g transform="translate(72 62)">
                  ${repeat(
                    analytics.donutSegments ?? [],
                    (segment) => segment.id,
                    (segment) => html`<path class="workspace-donut__${segment.id}" d="${segment.path}"></path>`,
                  )}
                </g>
              </svg>
              <p>${analytics.averageTagsDisplay} average tags per item</p>
            </section>
          </div>`
        : ""}
      <footer class="workspace-intelligence__automation">
        <details>
          <summary>Automation schedule · ${schedulePreview.label}</summary>
          <label>
            <span>Digest cadence</span>
            <select data-action="workspace-schedule" @change=${this.onSchedule}>
              ${repeat(
                intelligence.scheduleOptions ?? [],
                (option) => option.id,
                (option) => html`<option ?selected=${option.active} value="${option.id}">${option.label}</option>`,
              )}
            </select>
          </label>
          <p>Next run ${schedulePreview.humanized}</p>
          <ol>
            ${repeat(
              schedulePreview.dates ?? [],
              (date) => date.id,
              (date) => html`<li>${date.label}</li>`,
            )}
          </ol>
        </details>
      </footer>
    </section>`;
  }
}

customElements.define("workspace-intelligence", WorkspaceIntelligence);
