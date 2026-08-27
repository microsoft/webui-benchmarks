// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { WebUIElement, observable } from "@microsoft/webui-framework";
import {
  WORKSPACE_SCHEDULE_IDS,
  WORKSPACE_VIEW_IDS,
  assembleWorkspaceIntelligence,
  deriveWorkspaceRows,
  normalizeWorkspaceControls,
} from "../../../../shared/workspace-intelligence-core.mjs";

type WorkspaceModel = Record<string, unknown>;
type WorkspaceTodo = Record<string, unknown> & { id: string };
type SearchWorkspaceIds = (
  todos: WorkspaceTodo[],
  query: string,
) => Set<string>;

function workspaceIds(value: unknown): Array<{ id: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry !== null && typeof entry === "object"
        && "id" in entry && typeof entry.id === "string"
      ? [{ id: entry.id }]
      : []
  );
}

export class WorkspaceIntelligence extends WebUIElement {
  @observable intelligence: WorkspaceModel = {};
  @observable todos: WorkspaceTodo[] = [];

  private baselineAnalytics: unknown;
  private baselineSchedulePreview: unknown;
  private hydrated = false;
  private interactionQueue = Promise.resolve();
  private matchingIds = new Set<string>();
  private searchGeneration = 0;
  private searchWorkspaceIds: SearchWorkspaceIds | undefined;

  protected override hydratedCallback(): void {
    this.hydrated = true;
    this.matchingIds = Object.hasOwn(this.intelligence, "matchingIds")
      ? new Set(
          workspaceIds(this.intelligence.matchingIds).map(({ id }) => id),
        )
      : new Set(this.todos.map(({ id }) => id));
    this.baselineAnalytics = this.intelligence.analytics;
    this.baselineSchedulePreview = this.intelligence.schedulePreview;
  }

  todosChanged(previous: WorkspaceTodo[], next: WorkspaceTodo[]): void {
    if (this.hydrated && previous !== next) {
      void this.enqueue(async () => {
        const query = this.intelligence.query;
        if (
          this.searchWorkspaceIds !== undefined
          && typeof query === "string"
          && query.length > 0
        ) {
          this.matchingIds = this.searchWorkspaceIds(this.todos, query);
        }
        await this.rebuild();
      });
    }
  }

  onSearch(event: Event): Promise<void> {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return Promise.resolve();
    const generation = ++this.searchGeneration;
    const query = input.value;
    return this.enqueue(async () => {
      const { searchWorkspaceIds } = await import(
        "../../../../shared/workspace-search.mjs"
      );
      if (generation !== this.searchGeneration) return;
      this.searchWorkspaceIds = searchWorkspaceIds;
      this.matchingIds = searchWorkspaceIds(this.todos, query);
      await this.rebuild({ query, selectedIds: [] });
    });
  }

  onFilter(facet: string, event: Event): Promise<void> {
    if (!["assignment", "priority", "status", "sort"].includes(facet)) {
      throw new RangeError(`Unknown workspace facet '${facet}'`);
    }
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) {
      const value = select.value;
      return this.enqueue(() =>
        this.rebuild({ [facet]: value, selectedIds: [] })
      );
    }
    return Promise.resolve();
  }

  onSchedule(event: Event): Promise<void> {
    const select = event.currentTarget;
    if (!(select instanceof HTMLSelectElement)) return Promise.resolve();
    const schedule = select.value;
    if (!WORKSPACE_SCHEDULE_IDS.includes(schedule)) {
      throw new RangeError(`Unknown schedule '${schedule}'`);
    }
    return this.enqueue(async () => {
      const { createWorkspaceSchedulePreview } = await import(
        "../../../../shared/workspace-schedule.mjs"
      );
      await this.rebuild(
        { schedule },
        { schedulePreview: createWorkspaceSchedulePreview(schedule) },
      );
    });
  }

  onClick(event: MouseEvent): Promise<void> {
    const action = event.composedPath().find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return Promise.resolve();
    const actionId = action.dataset.action;
    const { todoId, view } = action.dataset;
    return this.enqueue(() => this.applyClick(actionId, todoId, view));
  }

  private async applyClick(
    actionId: string | undefined,
    todoId: string | undefined,
    view: string | undefined,
  ): Promise<void> {
    if (actionId === "workspace-view" && view !== undefined) {
      if (!WORKSPACE_VIEW_IDS.includes(view)) {
        throw new RangeError(`Unknown workspace view '${view}'`);
      }
      await this.rebuild({ view });
    } else if (
      actionId === "workspace-row-select"
      && todoId !== undefined
    ) {
      const selectedIds = workspaceIds(this.intelligence.selectedIds);
      const index = selectedIds.findIndex(({ id }) => id === todoId);
      if (index === -1) selectedIds.push({ id: todoId });
      else selectedIds.splice(index, 1);
      await this.rebuild({ selectedIds });
    } else if (actionId === "workspace-select-all") {
      const previewRows = Array.isArray(this.intelligence.previewRows)
        ? this.intelligence.previewRows
        : [];
      await this.rebuild({ selectedIds: workspaceIds(previewRows) });
    } else if (actionId === "workspace-archive") {
      const archived = workspaceIds(this.intelligence.archivedIds);
      const selected = workspaceIds(this.intelligence.selectedIds);
      await this.rebuild({
        archivedIds: [
          ...new Map(
            [...archived, ...selected].map((entry) => [entry.id, entry]),
          ).values(),
        ],
        selectedIds: [],
      });
    } else if (actionId === "workspace-save-view") {
      await this.saveView();
    } else if (actionId === "workspace-export") {
      await this.exportRows();
    } else if (actionId === "workspace-reset") {
      await this.reset();
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.interactionQueue.then(operation, operation);
    this.interactionQueue = queued;
    return queued;
  }

  private async saveView(): Promise<void> {
    const { parseSavedWorkspaceView } = await import(
      "../../../../shared/workspace-saved-view.mjs"
    );
    const savedViews = Array.isArray(this.intelligence.savedViews)
      ? this.intelligence.savedViews
      : [];
    const id = `saved-${savedViews.length + 1}`;
    const candidate = {
      assignment: this.intelligence.assignment,
      id,
      label: `Saved view ${savedViews.length + 1}`,
      priority: this.intelligence.priority,
      query: this.intelligence.query,
      sort: this.intelligence.sort,
      status: this.intelligence.status,
      view: this.intelligence.view,
    };
    const parsed = parseSavedWorkspaceView(candidate);
    if (parsed.success) {
      await this.rebuild({
        savedViews: [...savedViews, parsed.data],
        validationMessage: `${parsed.data.label} saved and validated`,
      });
      return;
    }
    await this.rebuild({
      validationMessage: parsed.error.issues[0]?.message
        ?? "Saved view validation failed",
    });
  }

  private async exportRows(): Promise<void> {
    const { createWorkspaceCsv } = await import(
      "../../../../shared/workspace-csv.mjs"
    );
    const rows = Array.isArray(this.intelligence.previewRows)
      ? this.intelligence.previewRows
      : [];
    const csv = createWorkspaceCsv(rows);
    await this.rebuild({
      exportBytes: new TextEncoder().encode(csv).byteLength,
      exportRows: rows.length,
      exportStatus: "CSV export generated",
    });
  }

  private async reset(): Promise<void> {
    this.searchGeneration += 1;
    this.matchingIds = new Set(this.todos.map(({ id }) => id));
    await this.rebuild(
      {},
      {
        analytics: this.baselineAnalytics,
        replace: true,
        schedulePreview: this.baselineSchedulePreview,
      },
    );
  }

  private async rebuild(
    changes: WorkspaceModel = {},
    options: {
      analytics?: unknown;
      replace?: boolean;
      schedulePreview?: unknown;
    } = {},
  ): Promise<void> {
    const createInputs = () => {
      const controls = normalizeWorkspaceControls({
        ...(options.replace ? {} : this.intelligence),
        ...changes,
      });
      return {
        controls,
        rows: deriveWorkspaceRows(this.todos, controls, this.matchingIds),
      };
    };
    let { controls, rows } = createInputs();
    let analytics = options.analytics ?? this.intelligence.analytics;
    if (controls.view === "insights" && options.analytics === undefined) {
      const { createWorkspaceAnalytics } = await import(
        "../../../../shared/workspace-analytics.mjs"
      );
      ({ controls, rows } = createInputs());
      analytics = createWorkspaceAnalytics(rows);
    }
    const schedulePreview = options.schedulePreview
      ?? this.intelligence.schedulePreview;
    this.commit(assembleWorkspaceIntelligence(controls, rows, {
      analytics,
      schedulePreview,
    }));
  }

  private commit(intelligence: WorkspaceModel): void {
    this.intelligence = intelligence;
    this.$emit("workspace-change", { intelligence });
  }
}

WorkspaceIntelligence.define("workspace-intelligence");
