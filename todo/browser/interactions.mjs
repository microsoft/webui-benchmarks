// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export async function executeTodoInteractionSequence({
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
      remainingAfterClear: allItems().length,
      selectedSentinel: sentinelId,
      totalBeforeClear: 100,
    },
    startedAtMs,
    totalDurationMs,
  };
}
