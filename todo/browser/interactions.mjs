// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export const CANONICAL_INTERACTION_STEP_IDS = Object.freeze([
  "searchWorkspaceMs",
  "filterWorkspaceStatusMs",
  "filterWorkspacePriorityMs",
  "filterWorkspaceAssignmentMs",
  "sortWorkspaceMs",
  "selectWorkspaceRowMs",
  "exportWorkspaceMs",
  "saveWorkspaceViewMs",
  "archiveWorkspaceMs",
  "resetWorkspaceMs",
  "showWorkspaceBoardMs",
  "showWorkspaceInsightsMs",
  "scheduleWorkspaceMs",
  "finalizeWorkspaceMs",
  "filterPendingMs",
  "filterCompletedMs",
  "filterAllMs",
  "selectSentinelMs",
  "toggleCompletionMs",
  "clearCompletedMs",
  "navigateActivityMs",
  "filterActivityMs",
  "expandActivityMs",
  "markActivityReadMs",
  "navigateSettingsMs",
  "toggleSettingMs",
  "selectDensityMs",
  "saveSettingsMs",
  "navigateWorkMs",
]);

export async function executeTodoInteractionSequence({
  activitySentinelId = "activity-0026",
  sentinelId = "todo-0050",
  timeoutMs = 5_000,
} = {}) {
  const microtaskSettleTurns = 8;
  const startedAtMs = performance.now();
  const queryAll = (selector) =>
    globalThis.__TODO_BENCH_QUERY_ALL__?.(selector)
      ?? Array.from(document.querySelectorAll(selector));
  const query = (selector) => queryAll(selector)[0] ?? null;
  const allItems = () =>
    queryAll(".todo-item[data-todo-id]");
  const checkboxByTodoId = new Map(
    queryAll('.todo-checkbox[data-action="toggle-completion"]').map(
      (element) => [element.dataset.todoId, element],
    ),
  );
  const checkbox = (item) => {
    const todoId = item.dataset.todoId;
    let result = checkboxByTodoId.get(todoId);
    if (result?.isConnected === true) return result;
    result = queryAll(
      '.todo-checkbox[data-action="toggle-completion"]',
    ).find((candidate) => candidate.dataset.todoId === todoId);
    if (result !== undefined) checkboxByTodoId.set(todoId, result);
    return result ?? null;
  };
  const isVisible = (item) =>
    !item.hidden
    && getComputedStyle(item).display !== "none"
    && getComputedStyle(item).visibility !== "hidden";
  const visibleItems = () => allItems().filter(isVisible);
  const assert = (condition, message) => {
    if (!condition) {
      throw new Error(`Interaction validation failed: ${message}`);
    }
  };
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const waitFor = async (predicate, description) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      // Reactive runtimes commonly coalesce through one or more microtasks.
      // Let that queue settle before charging them for an extra display frame.
      for (let turn = 0; turn < microtaskSettleTurns; turn++) {
        if (predicate()) {
          await nextFrame();
          return;
        }
        await Promise.resolve();
      }
      await nextFrame();
    }
    throw new Error(`Timed out waiting for ${description}`);
  };
  const time = async (id, action, predicate) => {
    const startedAt = performance.now();
    action();
    await waitFor(predicate, id);
    return performance.now() - startedAt;
  };
  const setControlValue = (control, value, eventType) => {
    const prototype = control instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLSelectElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    assert(typeof setter === "function", `${eventType} control has no value setter`);
    setter.call(control, value);
    control.dispatchEvent(new Event(eventType, {
      bubbles: true,
      composed: true,
    }));
  };
  const markJavascriptPhase = async (phase) => {
    const publish = globalThis.__TODO_BENCH_JAVASCRIPT_PHASE__;
    if (typeof publish === "function") {
      await publish(phase);
    }
  };
  const timeInitialFilter = async (action, predicate) => {
    const startedAt = performance.now();
    action();
    const retryAt = performance.now() + 1_000;
    while (performance.now() < retryAt) {
      for (let turn = 0; turn < microtaskSettleTurns; turn++) {
        if (predicate()) {
          await nextFrame();
          return performance.now() - startedAt;
        }
        await Promise.resolve();
      }
      await nextFrame();
    }
    action();
    await waitFor(predicate, "pending filter");
    return performance.now() - startedAt;
  };
  const filterButton = (filterId) =>
    query(
      `.todo-filter[data-action="filter"][data-filter="${filterId}"]`,
    );
  const selectButton = () =>
    query(
      `[data-action="select"][data-todo-id="${sentinelId}"]`,
    );

  const initialItems = allItems();
  assert(initialItems.length === 100, "the initial DOM must contain 100 todos");
  const initialCompleted = initialItems.filter(
    (item) => checkbox(item)?.checked === true,
  ).length;
  const initialPending = initialItems.length - initialCompleted;
  const pendingButton = filterButton("pending");
  const completedButton = filterButton("completed");
  const allButton = filterButton("all");
  assert(pendingButton instanceof HTMLElement, "pending filter is missing");
  assert(completedButton instanceof HTMLElement, "completed filter is missing");
  assert(allButton instanceof HTMLElement, "all filter is missing");

  const durations = {};
  const workspace = () => query(".workspace-intelligence");
  const workspaceHas = (attribute, value) =>
    workspace()?.getAttribute(attribute) === String(value);
  assert(workspaceHas("data-result-count", 100), "workspace must index 100 items");

  const workspaceSearch = query('[data-action="workspace-search"]');
  assert(
    workspaceSearch instanceof HTMLInputElement,
    "workspace search is missing",
  );
  durations.searchWorkspaceMs = await time(
    "workspace search",
    () => setControlValue(workspaceSearch, "Todo 0050", "input"),
    () =>
      workspaceHas("data-result-count", 1)
      && query(
        `[data-action="workspace-row-select"][data-todo-id="${sentinelId}"]`,
      ) instanceof HTMLInputElement,
  );
  await markJavascriptPhase("search");
  const workspaceSentinel = query(
    `[data-workspace-row="${sentinelId}"]`,
  );
  assert(workspaceSentinel instanceof HTMLElement, "workspace sentinel is missing");
  const workspaceFacets = {
    assignment: workspaceSentinel.dataset.assignment,
    priority: workspaceSentinel.dataset.priority,
    status: workspaceSentinel.dataset.status,
  };
  assert(
    ["completed", "pending"].includes(workspaceFacets.status),
    "workspace sentinel status is invalid",
  );
  assert(
    ["high", "medium", "low"].includes(workspaceFacets.priority),
    "workspace sentinel priority is invalid",
  );
  assert(
    ["assigned", "unassigned"].includes(workspaceFacets.assignment),
    "workspace sentinel assignment is invalid",
  );

  const setWorkspaceFacet = async (facet, value, label) => {
    const select = query(
      `[data-action="workspace-filter"][data-facet="${facet}"]`,
    );
    assert(select instanceof HTMLSelectElement, `${label} facet is missing`);
    return time(
      label,
      () => setControlValue(select, value, "change"),
      () =>
        query(
          `[data-action="workspace-filter"][data-facet="${facet}"]`,
        )?.value === value
        && workspaceHas("data-result-count", 1),
    );
  };
  durations.filterWorkspaceStatusMs = await setWorkspaceFacet(
    "status",
    workspaceFacets.status,
    "workspace status filter",
  );
  durations.filterWorkspacePriorityMs = await setWorkspaceFacet(
    "priority",
    workspaceFacets.priority,
    "workspace priority filter",
  );
  durations.filterWorkspaceAssignmentMs = await setWorkspaceFacet(
    "assignment",
    workspaceFacets.assignment,
    "workspace assignment filter",
  );
  durations.sortWorkspaceMs = await setWorkspaceFacet(
    "sort",
    "title",
    "workspace sort",
  );

  const workspaceRow = query(
    `[data-action="workspace-row-select"][data-todo-id="${sentinelId}"]`,
  );
  assert(workspaceRow instanceof HTMLInputElement, "workspace row is missing");
  durations.selectWorkspaceRowMs = await time(
    "workspace row selection",
    () => workspaceRow.click(),
    () =>
      workspaceHas("data-selected-count", 1)
      && query(
        `[data-action="workspace-row-select"][data-todo-id="${sentinelId}"]`,
      )?.checked === true,
  );

  const workspaceAction = (action) =>
    query(`[data-action="${action}"]`);
  const exportWorkspace = workspaceAction("workspace-export");
  assert(exportWorkspace instanceof HTMLButtonElement, "workspace export is missing");
  durations.exportWorkspaceMs = await time(
    "workspace CSV export",
    () => exportWorkspace.click(),
    () => workspaceHas("data-export-rows", 1),
  );
  await markJavascriptPhase("export");

  const saveWorkspace = workspaceAction("workspace-save-view");
  assert(saveWorkspace instanceof HTMLButtonElement, "save view action is missing");
  durations.saveWorkspaceViewMs = await time(
    "save workspace view",
    () => saveWorkspace.click(),
    () => workspaceHas("data-saved-view-count", 1),
  );
  await markJavascriptPhase("saved-view");

  const archiveWorkspace = workspaceAction("workspace-archive");
  assert(
    archiveWorkspace instanceof HTMLButtonElement,
    "workspace archive is missing",
  );
  durations.archiveWorkspaceMs = await time(
    "archive workspace selection",
    () => archiveWorkspace.click(),
    () =>
      workspaceHas("data-archived-count", 1)
      && workspaceHas("data-result-count", 0)
      && workspaceHas("data-selected-count", 0),
  );

  const resetWorkspace = () => {
    const reset = workspaceAction("workspace-reset");
    assert(reset instanceof HTMLButtonElement, "workspace reset is missing");
    reset.click();
  };
  durations.resetWorkspaceMs = await time(
    "reset workspace filters",
    resetWorkspace,
    () =>
      workspaceHas("data-archived-count", 0)
      && workspaceHas("data-result-count", 100)
      && workspaceHas("data-workspace-view", "table"),
  );

  const selectWorkspacePanel = async (view, label) => {
    const button = query(
      `[data-action="workspace-view"][data-view="${view}"]`,
    );
    assert(button instanceof HTMLButtonElement, `${label} view is missing`);
    return time(
      label,
      () => button.click(),
      () =>
        workspaceHas("data-workspace-view", view)
        && query(`[data-workspace-panel="${view}"]`) instanceof HTMLElement,
    );
  };
  durations.showWorkspaceBoardMs = await selectWorkspacePanel(
    "board",
    "workspace board view",
  );
  durations.showWorkspaceInsightsMs = await selectWorkspacePanel(
    "insights",
    "workspace insights view",
  );
  await markJavascriptPhase("insights");

  const schedule = query('[data-action="workspace-schedule"]');
  assert(schedule instanceof HTMLSelectElement, "workspace schedule is missing");
  durations.scheduleWorkspaceMs = await time(
    "workspace schedule",
    () => setControlValue(schedule, "weekly", "change"),
    () => workspaceHas("data-workspace-schedule", "weekly"),
  );
  await markJavascriptPhase("schedule");
  durations.finalizeWorkspaceMs = await time(
    "final workspace reset",
    resetWorkspace,
    () =>
      workspaceHas("data-result-count", 100)
      && workspaceHas("data-workspace-schedule", "weekdays")
      && workspaceHas("data-workspace-view", "table"),
  );

  durations.filterPendingMs = await timeInitialFilter(
    () => filterButton("pending").click(),
    () =>
      filterButton("pending")?.getAttribute("aria-pressed") === "true"
      && visibleItems().length === initialPending
      && visibleItems().every((item) => checkbox(item)?.checked === false),
  );
  assert(
    visibleItems().every((item) => checkbox(item)?.checked === false),
    "pending filter exposed a completed todo",
  );

  durations.filterCompletedMs = await time(
    "completed filter",
    () => filterButton("completed").click(),
    () =>
      filterButton("completed")?.getAttribute("aria-pressed") === "true"
      && visibleItems().length === initialCompleted
      && visibleItems().every((item) => checkbox(item)?.checked === true),
  );
  assert(
    visibleItems().every((item) => checkbox(item)?.checked === true),
    "completed filter exposed a pending todo",
  );

  durations.filterAllMs = await time(
    "all filter",
    () => filterButton("all").click(),
    () =>
      filterButton("all")?.getAttribute("aria-pressed") === "true"
      && visibleItems().length === 100,
  );

  const selector = selectButton();
  assert(selector instanceof HTMLElement, "sentinel select action is missing");
  durations.selectSentinelMs = await time(
    "sentinel selection",
    () => selector.click(),
    () => {
      const selected = allItems().filter(
        (item) => item.getAttribute("aria-selected") === "true",
      );
      return selected.length === 1
        && selected[0].dataset.todoId === sentinelId
        && query(".todo-toolbar__selection")?.textContent
          ?.includes(sentinelId) === true;
    },
  );
  const sentinel = query(
    `.todo-item[data-todo-id="${sentinelId}"]`,
  );
  assert(sentinel instanceof HTMLElement, "selected sentinel is missing");
  const sentinelCheckbox = checkbox(sentinel);
  assert(
    sentinelCheckbox instanceof HTMLInputElement,
    "sentinel checkbox is missing",
  );
  const completedBeforeToggle = sentinelCheckbox.checked;
  durations.toggleCompletionMs = await time(
    "sentinel completion toggle",
    () => sentinelCheckbox.click(),
    () => {
      const current = query(
        `.todo-item[data-todo-id="${sentinelId}"]`,
      );
      const currentCheckbox = current === null ? null : checkbox(current);
      const branch = completedBeforeToggle ? "pending" : "completed";
      return currentCheckbox?.checked === !completedBeforeToggle
        && current?.querySelector(
          `.todo-badge[data-branch~="${branch}"]`,
        ) !== null;
    },
  );

  const completedBeforeClear = allItems().filter(
    (item) => checkbox(item)?.checked === true,
  ).length;
  const expectedRemaining = 100 - completedBeforeClear;
  const clearButton = query(
    '.todo-button[data-action="clear-completed"]',
  );
  assert(clearButton instanceof HTMLButtonElement, "clear action is missing");
  assert(!clearButton.disabled, "clear action unexpectedly disabled");
  durations.clearCompletedMs = await time(
    "clear completed",
    () => clearButton.click(),
    () =>
      allItems().length === expectedRemaining
      && allItems().every((item) => checkbox(item)?.checked === false)
      && workspaceHas("data-result-count", expectedRemaining)
      && query(".todo-footer")?.textContent
        ?.includes(`${expectedRemaining} items`) === true
      && query(
          '.todo-button[data-action="clear-completed"]',
        )?.disabled === true,
  );
  assert(
    query(
      '.todo-badge[data-branch~="completed"]',
    ) === null,
    "completed semantic branches remain after clear",
  );
  const selectedAfterClear = allItems().filter(
    (item) => item.getAttribute("aria-selected") === "true",
  );
  assert(selectedAfterClear.length === 1, "clear must select one remaining todo");
  assert(
    query(".todo-toolbar__selection")?.textContent
      ?.includes(selectedAfterClear[0].dataset.todoId ?? "") === true,
    "clear left a stale selection summary",
  );
  const remainingAfterClear = allItems().length;
  await markJavascriptPhase("work-complete");

  const routeLink = (routeId) =>
    query(`[data-route-link="${routeId}"]`);
  const routePage = (routeId) =>
    query(`[data-route-page="${routeId}"]`);
  const activityLink = routeLink("activity");
  assert(activityLink instanceof HTMLAnchorElement, "activity route link is missing");
  durations.navigateActivityMs = await time(
    "activity route",
    () => activityLink.click(),
    () => {
      const page = routePage("activity");
      return page instanceof HTMLElement
        && isVisible(page)
        && page.hasAttribute("data-route-ready");
    },
  );

  const activityEvents = () =>
    queryAll(".activity-event[data-event-id]").filter(isVisible);
  assert(activityEvents().length === 48, "activity route must contain 48 events");
  const deploymentFilter = query(
    '[data-action="activity-filter"][data-filter="deployment"]',
  );
  assert(
    deploymentFilter instanceof HTMLButtonElement,
    "deployment activity filter is missing",
  );
  durations.filterActivityMs = await time(
    "deployment activity filter",
    () => deploymentFilter.click(),
    () =>
      query(
        '[data-action="activity-filter"][data-filter="deployment"]',
      )?.getAttribute("aria-pressed") === "true"
      && activityEvents().length === 16
      && activityEvents().every(
        (event) =>
          event.querySelector(".activity-event__type")?.textContent
            ?.trim() === "Deployment",
      ),
  );

  const activityToggle = query(
    `[data-action="activity-expand"][data-event-id="${activitySentinelId}"]`,
  );
  assert(
    activityToggle instanceof HTMLButtonElement,
    "activity sentinel expansion is missing",
  );
  durations.expandActivityMs = await time(
    "activity detail expansion",
    () => activityToggle.click(),
    () =>
      query(
        `[data-action="activity-expand"][data-event-id="${activitySentinelId}"]`,
      )?.getAttribute("aria-expanded") === "true"
      && query(
        `.activity-event[data-event-id="${activitySentinelId}"] .activity-event__detail`,
      ) !== null,
  );

  const markRead = query('[data-action="activity-mark-read"]');
  assert(markRead instanceof HTMLButtonElement, "mark-all-read action is missing");
  durations.markActivityReadMs = await time(
    "mark all activity read",
    () => markRead.click(),
    () =>
      query('[data-action="activity-mark-read"]')?.disabled === true
      && queryAll(".activity-event[data-unread]").length === 0,
  );

  const settingsLink = routeLink("settings");
  assert(settingsLink instanceof HTMLAnchorElement, "settings route link is missing");
  durations.navigateSettingsMs = await time(
    "settings route",
    () => settingsLink.click(),
    () => {
      const page = routePage("settings");
      return page instanceof HTMLElement
        && isVisible(page)
        && page.hasAttribute("data-route-ready");
    },
  );

  const digest = query(
    '[data-action="setting-toggle"][data-setting-id="daily-digest"]',
  );
  assert(digest instanceof HTMLInputElement, "daily digest setting is missing");
  const digestBefore = digest.checked;
  durations.toggleSettingMs = await time(
    "daily digest setting",
    () => digest.click(),
    () =>
      query(
        '[data-action="setting-toggle"][data-setting-id="daily-digest"]',
      )?.checked === !digestBefore,
  );

  const compact = query(
    '[data-action="setting-density"][data-density="compact"]',
  );
  assert(compact instanceof HTMLButtonElement, "compact density action is missing");
  durations.selectDensityMs = await time(
    "compact density",
    () => compact.click(),
    () =>
      query(
        '[data-action="setting-density"][data-density="compact"]',
      )?.getAttribute("aria-pressed") === "true"
      && routePage("settings")?.getAttribute("data-density") === "compact",
  );

  const save = query('[data-action="settings-save"]');
  assert(save instanceof HTMLButtonElement, "settings save action is missing");
  durations.saveSettingsMs = await time(
    "save settings",
    () => save.click(),
    () =>
      query('[data-action="settings-save"]')?.disabled === true
      && query(".settings-status")?.textContent?.trim() === "Preferences saved",
  );

  const workLink = routeLink("work");
  assert(workLink instanceof HTMLAnchorElement, "work route link is missing");
  durations.navigateWorkMs = await time(
    "work route",
    () => workLink.click(),
    () => {
      const page = routePage("work");
      return page instanceof HTMLElement
        && isVisible(page)
        && allItems().length === 100;
    },
  );

  const totalDurationMs = Object.values(durations).reduce(
    (total, value) => total + value,
    0,
  );
  return {
    durations,
    evidence: {
      completedBeforeClear,
      initialCompleted,
      initialPending,
      remainingAfterClear,
      activityEvents: 48,
      activitySentinel: activitySentinelId,
      activityVisibleAfterFilter: 16,
      settingsDensity: "compact",
      settingsSaved: true,
      workItemsAfterReturn: allItems().length,
      selectedSentinel: sentinelId,
      totalBeforeClear: 100,
      workspaceArchived: 1,
      workspaceAfterClear: remainingAfterClear,
      workspaceExportRows: 1,
      workspaceFacets,
      workspaceFinalResults: 100,
      workspaceSavedViews: 1,
      workspaceSchedule: "weekly",
      workspaceSearchResult: 1,
      workspaceSelectedSentinel: sentinelId,
      workspaceViews: ["board", "insights"],
    },
    startedAtMs,
    totalDurationMs,
  };
}
