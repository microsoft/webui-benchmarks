// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { For, Show } from "solid-js";
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
} from "../../../shared/workspace-intelligence-client.mjs";

export function WorkspaceIntelligence(props) {
  const model = () => props.state.intelligence;
  let updateQueue = Promise.resolve();
  const update = (reducer) => {
    const run = async () => {
      props.onStateChange(await reducer(() => props.state));
    };
    const operation = updateQueue.then(run, run);
    updateQueue = operation;
    return operation;
  };
  return (
    <workspace-intelligence data-component="workspace-intelligence">
      <section
        class="workspace-intelligence"
        data-archived-count={model().archivedCount}
        data-export-rows={model().exportRows}
        data-result-count={model().resultCount}
        data-saved-view-count={model().savedViewCount}
        data-selected-count={model().selectedCount}
        data-workspace-schedule={model().schedule}
        data-workspace-view={model().view}
      >
        <header class="workspace-intelligence__header">
          <div>
            <h2>Workspace intelligence</h2>
            <p>Search, segment, compare, and automate the complete work queue.</p>
          </div>
          <output class="workspace-intelligence__result">
            {model().resultLabel}
          </output>
        </header>
        <div class="workspace-intelligence__filters">
          <label class="workspace-search">
            <span>Search work</span>
            <input
              data-action="workspace-search"
              onInput={(event) => {
                const { value } = event.currentTarget;
                void update((state) => searchWorkspace(state, value));
              }}
              placeholder="Title, owner, tag, status…"
              type="search"
              value={model().query}
            />
          </label>
          <For each={[
            ["status", "Status", model().statusOptions],
            ["priority", "Priority", model().priorityOptions],
            ["assignment", "Assignment", model().assignmentOptions],
            ["sort", "Sort by", model().sortOptions],
          ]}>
            {([facet, label, options]) => (
              <label>
                <span>{label}</span>
                <select
                  data-action="workspace-filter"
                  data-facet={facet}
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    void update((state) =>
                      filterWorkspace(state, facet, value)
                    );
                  }}
                  value={model()[facet]}
                >
                  <For each={options}>
                    {(option) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
            )}
          </For>
        </div>
        <div class="workspace-intelligence__commandbar">
          <div class="workspace-view-switch" role="group" aria-label="Work view">
            <For each={model().viewOptions}>
              {(option) => (
                <button
                  aria-pressed={option.active}
                  data-action="workspace-view"
                  data-view={option.id}
                  onClick={() =>
                    update((state) => selectWorkspaceView(state, option.id))}
                  type="button"
                >{option.label}</button>
              )}
            </For>
          </div>
          <div class="workspace-intelligence__actions">
            <button data-action="workspace-select-all" onClick={() => update(selectWorkspaceResults)} type="button">Select preview</button>
            <button data-action="workspace-archive" disabled={model().selectedCount === 0} onClick={() => update(archiveWorkspaceSelection)} type="button">Archive selected</button>
            <button data-action="workspace-save-view" onClick={() => update(saveWorkspaceView)} type="button">Save view</button>
            <button data-action="workspace-export" onClick={() => update(exportWorkspaceRows)} type="button">Export CSV</button>
            <button data-action="workspace-reset" onClick={() => update(resetWorkspaceIntelligence)} type="button">Reset</button>
          </div>
        </div>
        <div class="workspace-intelligence__status" aria-live="polite">
          <span>{model().selectedLabel}</span>
          <span>{model().savedViewCount} saved views</span>
          <span>{model().archivedCount} archived</span>
          <span>{model().exportGeneratedLabel}</span>
          <span>{model().validationMessage}</span>
        </div>
        <Show when={model().view === "table"}>
          <div class="workspace-table-wrap" data-workspace-panel="table">
            <table class="workspace-table">
              <thead><tr><th scope="col">Select</th><th scope="col">Item</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Tags</th></tr></thead>
              <tbody>
                <For each={model().previewRows}>
                  {(row) => (
                    <tr
                      data-assignment={row.assignment}
                      data-priority={row.priority}
                      data-status={row.status}
                      data-workspace-row={row.id}
                    >
                      <td><input aria-label={`Select ${row.id}`} checked={row.bulkSelected} data-action="workspace-row-select" data-todo-id={row.id} onChange={() => update((state) => toggleWorkspaceRow(state, row.id))} type="checkbox" /></td>
                      <th scope="row"><span>{row.id}</span><strong>{row.title}</strong></th>
                      <td>{row.statusLabel}</td><td>{row.priorityLabel}</td><td>{row.owner}</td><td>{row.dueLabel}</td><td>{row.tagLabel}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
        <Show when={model().view === "board"}>
          <div class="workspace-board" data-workspace-panel="board">
            <For each={model().boardColumns}>
              {(column) => (
                <section data-priority={column.id}>
                  <header><h3>{column.label}</h3><span>{column.count}</span></header>
                  <ol><For each={column.items}>{(row) => <li><strong>{row.title}</strong><span>{row.owner}</span><small>{row.statusLabel} · {row.dueLabel}</small></li>}</For></ol>
                </section>
              )}
            </For>
          </div>
        </Show>
        <Show when={model().view === "insights"}>
          <div class="workspace-insights" data-workspace-panel="insights">
            <section class="workspace-chart"><h3>Queue momentum</h3><svg aria-label="Work queue trend" role="img" viewBox="0 0 300 120"><path class="workspace-chart__area" d={model().analytics.areaPath} /><path class="workspace-chart__line" d={model().analytics.trendPath} /></svg></section>
            <section class="workspace-priority-bars"><h3>Priority distribution</h3><For each={model().analytics.priorityBars}>{(bar) => <label><span>{bar.label}</span><progress max="100" value={bar.percent} /><strong>{bar.count}</strong></label>}</For></section>
            <section class="workspace-donut"><h3>Status mix</h3><svg aria-label="Pending and completed work" role="img" viewBox="0 0 144 124"><g transform="translate(72 62)"><For each={model().analytics.donutSegments}>{(segment) => <path class={`workspace-donut__${segment.id}`} d={segment.path} />}</For></g></svg><p>{model().analytics.averageTagsDisplay} average tags per item</p></section>
          </div>
        </Show>
        <footer class="workspace-intelligence__automation">
          <details>
            <summary>Automation schedule · {model().schedulePreview.label}</summary>
            <label><span>Digest cadence</span><select data-action="workspace-schedule" onChange={(event) => { const { value } = event.currentTarget; void update((state) => setWorkspaceSchedule(state, value)); }} value={model().schedule}><For each={model().scheduleOptions}>{(option) => <option value={option.id}>{option.label}</option>}</For></select></label>
            <p>Next run {model().schedulePreview.humanized}</p>
            <ol><For each={model().schedulePreview.dates}>{(date) => <li>{date.label}</li>}</For></ol>
          </details>
        </footer>
      </section>
    </workspace-intelligence>
  );
}
