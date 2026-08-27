<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
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
  } from "../../../../../shared/workspace-intelligence-client.mjs";

  export let state;
  export let onStateChange;
  $: model = state.intelligence;
  let updateQueue = Promise.resolve();
  const update = (reducer) => {
    const run = async () => onStateChange(await reducer(() => state));
    const operation = updateQueue.then(run, run);
    updateQueue = operation;
    return operation;
  };

  function applyFacet(event) {
    const { facet } = event.currentTarget.dataset;
    const { value } = event.currentTarget;
    void update((current) => filterWorkspace(current, facet, value));
  }

  function applySchedule(event) {
    const { value } = event.currentTarget;
    void update((current) => setWorkspaceSchedule(current, value));
  }

  function applySearch(event) {
    const { value } = event.currentTarget;
    void update((current) => searchWorkspace(current, value));
  }
</script>

<workspace-intelligence data-component="workspace-intelligence">
  <section
    class="workspace-intelligence"
    data-archived-count={model.archivedCount}
    data-export-rows={model.exportRows}
    data-result-count={model.resultCount}
    data-saved-view-count={model.savedViewCount}
    data-selected-count={model.selectedCount}
    data-workspace-schedule={model.schedule}
    data-workspace-view={model.view}
  >
    <header class="workspace-intelligence__header">
      <div>
        <h2>Workspace intelligence</h2>
        <p>Search, segment, compare, and automate the complete work queue.</p>
      </div>
      <output class="workspace-intelligence__result">{model.resultLabel}</output>
    </header>
    <div class="workspace-intelligence__filters">
      <label class="workspace-search">
        <span>Search work</span>
        <input
          data-action="workspace-search"
          on:input={applySearch}
          placeholder="Title, owner, tag, status…"
          type="search"
          value={model.query}
        />
      </label>
      {#each [
        ["status", "Status", model.statusOptions],
        ["priority", "Priority", model.priorityOptions],
        ["assignment", "Assignment", model.assignmentOptions],
        ["sort", "Sort by", model.sortOptions]
      ] as [facet, label, options] (facet)}
        <label>
          <span>{label}</span>
          <select
            data-action="workspace-filter"
            data-facet={facet}
            on:change={applyFacet}
            value={model[facet]}
          >
            {#each options as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </label>
      {/each}
    </div>
    <div class="workspace-intelligence__commandbar">
      <div class="workspace-view-switch" role="group" aria-label="Work view">
        {#each model.viewOptions as option (option.id)}
          <button
            aria-pressed={option.active}
            data-action="workspace-view"
            data-view={option.id}
            on:click={() => update((value) => selectWorkspaceView(value, option.id))}
            type="button"
          >{option.label}</button>
        {/each}
      </div>
      <div class="workspace-intelligence__actions">
        <button data-action="workspace-select-all" on:click={() => update(selectWorkspaceResults)} type="button">Select preview</button>
        <button data-action="workspace-archive" disabled={model.selectedCount === 0} on:click={() => update(archiveWorkspaceSelection)} type="button">Archive selected</button>
        <button data-action="workspace-save-view" on:click={() => update(saveWorkspaceView)} type="button">Save view</button>
        <button data-action="workspace-export" on:click={() => update(exportWorkspaceRows)} type="button">Export CSV</button>
        <button data-action="workspace-reset" on:click={() => update(resetWorkspaceIntelligence)} type="button">Reset</button>
      </div>
    </div>
    <div class="workspace-intelligence__status" aria-live="polite">
      <span>{model.selectedLabel}</span>
      <span>{model.savedViewCount} saved views</span>
      <span>{model.archivedCount} archived</span>
      <span>{model.exportGeneratedLabel}</span>
      <span>{model.validationMessage}</span>
    </div>
    {#if model.view === "table"}
      <div class="workspace-table-wrap" data-workspace-panel="table">
        <table class="workspace-table">
          <thead><tr><th scope="col">Select</th><th scope="col">Item</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Tags</th></tr></thead>
          <tbody>
            {#each model.previewRows as row (row.id)}
              <tr
                data-assignment={row.assignment}
                data-priority={row.priority}
                data-status={row.status}
                data-workspace-row={row.id}
              >
                <td><input aria-label={`Select ${row.id}`} checked={row.bulkSelected} data-action="workspace-row-select" data-todo-id={row.id} on:change={() => update((value) => toggleWorkspaceRow(value, row.id))} type="checkbox" /></td>
                <th scope="row"><span>{row.id}</span><strong>{row.title}</strong></th>
                <td>{row.statusLabel}</td><td>{row.priorityLabel}</td><td>{row.owner}</td><td>{row.dueLabel}</td><td>{row.tagLabel}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if model.view === "board"}
      <div class="workspace-board" data-workspace-panel="board">
        {#each model.boardColumns as column (column.id)}
          <section data-priority={column.id}>
            <header><h3>{column.label}</h3><span>{column.count}</span></header>
            <ol>{#each column.items as row (row.id)}<li><strong>{row.title}</strong><span>{row.owner}</span><small>{row.statusLabel} · {row.dueLabel}</small></li>{/each}</ol>
          </section>
        {/each}
      </div>
    {:else}
      <div class="workspace-insights" data-workspace-panel="insights">
        <section class="workspace-chart"><h3>Queue momentum</h3><svg aria-label="Work queue trend" role="img" viewBox="0 0 300 120"><path class="workspace-chart__area" d={model.analytics.areaPath}></path><path class="workspace-chart__line" d={model.analytics.trendPath}></path></svg></section>
        <section class="workspace-priority-bars"><h3>Priority distribution</h3>{#each model.analytics.priorityBars as bar (bar.id)}<label><span>{bar.label}</span><progress max="100" value={bar.percent}></progress><strong>{bar.count}</strong></label>{/each}</section>
        <section class="workspace-donut"><h3>Status mix</h3><svg aria-label="Pending and completed work" role="img" viewBox="0 0 144 124"><g transform="translate(72 62)">{#each model.analytics.donutSegments as segment (segment.id)}<path class={`workspace-donut__${segment.id}`} d={segment.path}></path>{/each}</g></svg><p>{model.analytics.averageTagsDisplay} average tags per item</p></section>
      </div>
    {/if}
    <footer class="workspace-intelligence__automation">
      <details>
        <summary>Automation schedule · {model.schedulePreview.label}</summary>
        <label><span>Digest cadence</span><select data-action="workspace-schedule" on:change={applySchedule} value={model.schedule}>{#each model.scheduleOptions as option (option.id)}<option value={option.id}>{option.label}</option>{/each}</select></label>
        <p>Next run {model.schedulePreview.humanized}</p>
        <ol>{#each model.schedulePreview.dates as date (date.id)}<li>{date.label}</li>{/each}</ol>
      </details>
    </footer>
  </section>
</workspace-intelligence>
