<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import { computed } from "vue";
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

defineOptions({ name: "workspace-intelligence" });
const props = defineProps({
  state: { type: Object, required: true },
});
const emit = defineEmits(["state-change"]);
const model = computed(() => props.state.intelligence);
let updateQueue = Promise.resolve();
const update = (reducer) => {
  const run = async () => {
    emit("state-change", await reducer(() => props.state));
  };
  const operation = updateQueue.then(run, run);
  updateQueue = operation;
  return operation;
};

function applyFacet(event) {
  const { facet } = event.currentTarget.dataset;
  const { value } = event.currentTarget;
  void update((state) => filterWorkspace(state, facet, value));
}

function applySchedule(event) {
  const { value } = event.currentTarget;
  void update((state) => setWorkspaceSchedule(state, value));
}

function applySearch(event) {
  const { value } = event.currentTarget;
  void update((state) => searchWorkspace(state, value));
}
</script>

<template>
  <workspace-intelligence data-component="workspace-intelligence">
    <section
      class="workspace-intelligence"
      :data-archived-count="model.archivedCount"
      :data-export-rows="model.exportRows"
      :data-result-count="model.resultCount"
      :data-saved-view-count="model.savedViewCount"
      :data-selected-count="model.selectedCount"
      :data-workspace-schedule="model.schedule"
      :data-workspace-view="model.view"
    >
      <header class="workspace-intelligence__header">
        <div>
          <h2>Workspace intelligence</h2>
          <p>Search, segment, compare, and automate the complete work queue.</p>
        </div>
        <output class="workspace-intelligence__result">
          {{ model.resultLabel }}
        </output>
      </header>
      <div class="workspace-intelligence__filters">
        <label class="workspace-search">
          <span>Search work</span>
          <input
            data-action="workspace-search"
            placeholder="Title, owner, tag, status…"
            type="search"
            :value="model.query"
            @input="applySearch"
          />
        </label>
        <label>
          <span>Status</span>
          <select
            data-action="workspace-filter"
            data-facet="status"
            :value="model.status"
            @change="applyFacet"
          >
            <option
              v-for="option in model.statusOptions"
              :key="option.id"
              :value="option.id"
            >{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select
            data-action="workspace-filter"
            data-facet="priority"
            :value="model.priority"
            @change="applyFacet"
          >
            <option
              v-for="option in model.priorityOptions"
              :key="option.id"
              :value="option.id"
            >{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>Assignment</span>
          <select
            data-action="workspace-filter"
            data-facet="assignment"
            :value="model.assignment"
            @change="applyFacet"
          >
            <option
              v-for="option in model.assignmentOptions"
              :key="option.id"
              :value="option.id"
            >{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select
            data-action="workspace-filter"
            data-facet="sort"
            :value="model.sort"
            @change="applyFacet"
          >
            <option
              v-for="option in model.sortOptions"
              :key="option.id"
              :value="option.id"
            >{{ option.label }}</option>
          </select>
        </label>
      </div>
      <div class="workspace-intelligence__commandbar">
        <div class="workspace-view-switch" role="group" aria-label="Work view">
          <button
            v-for="option in model.viewOptions"
            :key="option.id"
            :aria-pressed="option.active"
            data-action="workspace-view"
            :data-view="option.id"
            type="button"
            @click="update((state) => selectWorkspaceView(state, option.id))"
          >{{ option.label }}</button>
        </div>
        <div class="workspace-intelligence__actions">
          <button data-action="workspace-select-all" type="button" @click="update(selectWorkspaceResults)">Select preview</button>
          <button data-action="workspace-archive" :disabled="model.selectedCount === 0" type="button" @click="update(archiveWorkspaceSelection)">Archive selected</button>
          <button data-action="workspace-save-view" type="button" @click="update(saveWorkspaceView)">Save view</button>
          <button data-action="workspace-export" type="button" @click="update(exportWorkspaceRows)">Export CSV</button>
          <button data-action="workspace-reset" type="button" @click="update(resetWorkspaceIntelligence)">Reset</button>
        </div>
      </div>
      <div class="workspace-intelligence__status" aria-live="polite">
        <span>{{ model.selectedLabel }}</span>
        <span>{{ model.savedViewCount }} saved views</span>
        <span>{{ model.archivedCount }} archived</span>
        <span>{{ model.exportGeneratedLabel }}</span>
        <span>{{ model.validationMessage }}</span>
      </div>
      <div
        v-if="model.view === 'table'"
        class="workspace-table-wrap"
        data-workspace-panel="table"
      >
        <table class="workspace-table">
          <thead><tr><th scope="col">Select</th><th scope="col">Item</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Tags</th></tr></thead>
          <tbody>
            <tr
              v-for="row in model.previewRows"
              :key="row.id"
              :data-assignment="row.assignment"
              :data-priority="row.priority"
              :data-status="row.status"
              :data-workspace-row="row.id"
            >
              <td><input :aria-label="`Select ${row.id}`" :checked="row.bulkSelected" data-action="workspace-row-select" :data-todo-id="row.id" type="checkbox" @change="update((state) => toggleWorkspaceRow(state, row.id))" /></td>
              <th scope="row"><span>{{ row.id }}</span><strong>{{ row.title }}</strong></th>
              <td>{{ row.statusLabel }}</td><td>{{ row.priorityLabel }}</td><td>{{ row.owner }}</td><td>{{ row.dueLabel }}</td><td>{{ row.tagLabel }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-else-if="model.view === 'board'"
        class="workspace-board"
        data-workspace-panel="board"
      >
        <section
          v-for="column in model.boardColumns"
          :key="column.id"
          :data-priority="column.id"
        >
          <header><h3>{{ column.label }}</h3><span>{{ column.count }}</span></header>
          <ol><li v-for="row in column.items" :key="row.id"><strong>{{ row.title }}</strong><span>{{ row.owner }}</span><small>{{ row.statusLabel }} · {{ row.dueLabel }}</small></li></ol>
        </section>
      </div>
      <div v-else class="workspace-insights" data-workspace-panel="insights">
        <section class="workspace-chart"><h3>Queue momentum</h3><svg aria-label="Work queue trend" role="img" viewBox="0 0 300 120"><path class="workspace-chart__area" :d="model.analytics.areaPath" /><path class="workspace-chart__line" :d="model.analytics.trendPath" /></svg></section>
        <section class="workspace-priority-bars"><h3>Priority distribution</h3><label v-for="bar in model.analytics.priorityBars" :key="bar.id"><span>{{ bar.label }}</span><progress max="100" :value="bar.percent" /><strong>{{ bar.count }}</strong></label></section>
        <section class="workspace-donut"><h3>Status mix</h3><svg aria-label="Pending and completed work" role="img" viewBox="0 0 144 124"><g transform="translate(72 62)"><path v-for="segment in model.analytics.donutSegments" :key="segment.id" :class="`workspace-donut__${segment.id}`" :d="segment.path" /></g></svg><p>{{ model.analytics.averageTagsDisplay }} average tags per item</p></section>
      </div>
      <footer class="workspace-intelligence__automation">
        <details>
          <summary>Automation schedule · {{ model.schedulePreview.label }}</summary>
          <label><span>Digest cadence</span><select data-action="workspace-schedule" :value="model.schedule" @change="applySchedule"><option v-for="option in model.scheduleOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
          <p>Next run {{ model.schedulePreview.humanized }}</p>
          <ol><li v-for="date in model.schedulePreview.dates" :key="date.id">{{ date.label }}</li></ol>
        </details>
      </footer>
    </section>
  </workspace-intelligence>
</template>
