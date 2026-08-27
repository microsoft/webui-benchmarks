// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

"use client";

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
} from "../../../shared/workspace-intelligence.mjs";

export function WorkspaceIntelligence({ current, onStateChange }) {
  const model = current.intelligence;
  const update = (reducer) => onStateChange((state) => reducer(state));

  return (
    <workspace-intelligence data-component="workspace-intelligence">
      <section
        className="workspace-intelligence"
        data-archived-count={model.archivedCount}
        data-export-rows={model.exportRows}
        data-result-count={model.resultCount}
        data-saved-view-count={model.savedViewCount}
        data-selected-count={model.selectedCount}
        data-workspace-schedule={model.schedule}
        data-workspace-view={model.view}
      >
        <header className="workspace-intelligence__header">
          <div>
            <h2>Workspace intelligence</h2>
            <p>
              Search, segment, compare, and automate the complete work queue.
            </p>
          </div>
          <output className="workspace-intelligence__result">
            {model.resultLabel}
          </output>
        </header>

        <div className="workspace-intelligence__filters">
          <label className="workspace-search">
            <span>Search work</span>
            <input
              data-action="workspace-search"
              onInput={(event) => {
                const { value } = event.currentTarget;
                update((state) => searchWorkspace(state, value));
              }}
              placeholder="Title, owner, tag, status…"
              type="search"
              value={model.query}
            />
          </label>
          {[
            ["status", "Status", model.statusOptions],
            ["priority", "Priority", model.priorityOptions],
            ["assignment", "Assignment", model.assignmentOptions],
            ["sort", "Sort by", model.sortOptions],
          ].map(([facet, label, options]) => (
            <label key={facet}>
              <span>{label}</span>
              <select
                data-action="workspace-filter"
                data-facet={facet}
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  update((state) => filterWorkspace(state, facet, value));
                }}
                value={model[facet]}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="workspace-intelligence__commandbar">
          <div className="workspace-view-switch" role="group" aria-label="Work view">
            {model.viewOptions.map((option) => (
              <button
                aria-pressed={option.active}
                data-action="workspace-view"
                data-view={option.id}
                key={option.id}
                onClick={() =>
                  update((state) => selectWorkspaceView(state, option.id))}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="workspace-intelligence__actions">
            <button
              data-action="workspace-select-all"
              onClick={() => update(selectWorkspaceResults)}
              type="button"
            >
              Select preview
            </button>
            <button
              data-action="workspace-archive"
              disabled={model.selectedCount === 0}
              onClick={() => update(archiveWorkspaceSelection)}
              type="button"
            >
              Archive selected
            </button>
            <button
              data-action="workspace-save-view"
              onClick={() => update(saveWorkspaceView)}
              type="button"
            >
              Save view
            </button>
            <button
              data-action="workspace-export"
              onClick={() => update(exportWorkspaceRows)}
              type="button"
            >
              Export CSV
            </button>
            <button
              data-action="workspace-reset"
              onClick={() => update(resetWorkspaceIntelligence)}
              type="button"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="workspace-intelligence__status" aria-live="polite">
          <span>{model.selectedLabel}</span>
          <span>{`${model.savedViewCount} saved views`}</span>
          <span>{`${model.archivedCount} archived`}</span>
          <span>{model.exportGeneratedLabel}</span>
          <span>{model.validationMessage}</span>
        </div>

        {model.view === "table" && (
          <div className="workspace-table-wrap" data-workspace-panel="table">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th scope="col">Select</th>
                  <th scope="col">Item</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Due</th>
                  <th scope="col">Tags</th>
                </tr>
              </thead>
              <tbody>
                {model.previewRows.map((row) => (
                  <tr
                    data-assignment={row.assignment}
                    data-priority={row.priority}
                    data-status={row.status}
                    data-workspace-row={row.id}
                    key={row.id}
                  >
                    <td>
                      <input
                        aria-label={`Select ${row.id}`}
                        checked={row.bulkSelected}
                        data-action="workspace-row-select"
                        data-todo-id={row.id}
                        onChange={() =>
                          update((state) => toggleWorkspaceRow(state, row.id))}
                        type="checkbox"
                      />
                    </td>
                    <th scope="row">
                      <span>{row.id}</span>
                      <strong>{row.title}</strong>
                    </th>
                    <td>{row.statusLabel}</td>
                    <td>{row.priorityLabel}</td>
                    <td>{row.owner}</td>
                    <td>{row.dueLabel}</td>
                    <td>{row.tagLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {model.view === "board" && (
          <div className="workspace-board" data-workspace-panel="board">
            {model.boardColumns.map((column) => (
              <section data-priority={column.id} key={column.id}>
                <header>
                  <h3>{column.label}</h3>
                  <span>{column.count}</span>
                </header>
                <ol>
                  {column.items.map((row) => (
                    <li key={row.id}>
                      <strong>{row.title}</strong>
                      <span>{row.owner}</span>
                      <small>{`${row.statusLabel} · ${row.dueLabel}`}</small>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}

        {model.view === "insights" && (
          <div className="workspace-insights" data-workspace-panel="insights">
            <section className="workspace-chart">
              <h3>Queue momentum</h3>
              <svg
                aria-label="Work queue trend"
                role="img"
                viewBox="0 0 300 120"
              >
                <path className="workspace-chart__area" d={model.analytics.areaPath} />
                <path className="workspace-chart__line" d={model.analytics.trendPath} />
              </svg>
            </section>
            <section className="workspace-priority-bars">
              <h3>Priority distribution</h3>
              {model.analytics.priorityBars.map((bar) => (
                <label key={bar.id}>
                  <span>{bar.label}</span>
                  <progress max="100" value={bar.percent} />
                  <strong>{bar.count}</strong>
                </label>
              ))}
            </section>
            <section className="workspace-donut">
              <h3>Status mix</h3>
              <svg
                aria-label="Pending and completed work"
                role="img"
                viewBox="0 0 144 124"
              >
                <g transform="translate(72 62)">
                  {model.analytics.donutSegments.map((segment) => (
                    <path
                      className={`workspace-donut__${segment.id}`}
                      d={segment.path}
                      key={segment.id}
                    />
                  ))}
                </g>
              </svg>
              <p>{`${model.analytics.averageTags.toFixed(1)} average tags per item`}</p>
            </section>
          </div>
        )}

        <footer className="workspace-intelligence__automation">
          <details>
            <summary>{`Automation schedule · ${model.schedulePreview.label}`}</summary>
            <label>
              <span>Digest cadence</span>
              <select
                data-action="workspace-schedule"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  update((state) => setWorkspaceSchedule(state, value));
                }}
                value={model.schedule}
              >
                {model.scheduleOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p>{`Next run ${model.schedulePreview.humanized}`}</p>
            <ol>
              {model.schedulePreview.dates.map((date) => (
                <li key={date.id}>{date.label}</li>
              ))}
            </ol>
          </details>
        </footer>
      </section>
    </workspace-intelligence>
  );
}
