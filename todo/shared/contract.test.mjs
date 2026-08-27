// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_EVENT_COUNT,
  ACTIVITY_SENTINEL_ID,
  APP_ROUTES,
  BRANCHES,
  ARIA_PRESSED_COUNT,
  CACHE_POLICIES,
  CACHE_POLICY_NAMES,
  COMPONENT_GRAPH,
  COMPONENTS,
  HEADLINE_CACHE_POLICY,
  INTERACTIONS,
  LOOPS,
  ROUTE_INTERACTIONS,
  SENTINEL_IDS,
  STATE_VARIANT_COUNT,
  TODO_ITEM_COUNT,
  TODO_BUTTON_COUNT,
  TODO_BENCH_CONTRACT,
  TODO_ITEM_FIELDS,
  TODO_ITEM_METADATA_FIELDS,
  WORKSPACE_INTERACTIONS,
  SETTING_CONTROL_COUNT,
  countTodoBranches,
} from "./contract.mjs";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
  createTodoState,
  createTodoStateVariants,
  currentRequestTimestamp,
} from "./state.mjs";
import {
  filterActivity,
  markActivityRead,
  saveSettings,
  selectDensity,
  toggleActivityDetail,
  toggleSetting,
} from "./workspace-interactions.mjs";
import {
  collectHtmlObservation,
} from "./observation.mjs";
import {
  createExpectedObservation,
  validateObservation,
  validateTodoState,
} from "./validator.mjs";

test("defines exactly the required 13 component boundaries", () => {
  assert.deepEqual(COMPONENTS, [
    "todo-app",
    "workspace-intelligence",
    "todo-header",
    "todo-summary",
    "todo-toolbar",
    "todo-filter",
    "todo-list",
    "todo-item",
    "todo-checkbox",
    "todo-badge",
    "todo-tag-list",
    "todo-button",
    "todo-footer",
  ]);
  assert.equal(new Set(COMPONENTS).size, 13);
  assert.deepEqual(COMPONENT_GRAPH["todo-toolbar"], [
    "todo-filter",
    "todo-button",
  ]);
  assert.ok(COMPONENT_GRAPH["todo-app"].includes("workspace-intelligence"));
  assert.deepEqual(COMPONENT_GRAPH["todo-item"], [
    "todo-checkbox",
    "todo-badge",
    "todo-tag-list",
    "todo-button",
  ]);
  assert.deepEqual(Object.keys(COMPONENT_GRAPH), COMPONENTS);
});

test("pins exact visible graph counts and cache policy names", () => {
  assert.equal(TODO_BUTTON_COUNT, 101);
  assert.equal(ARIA_PRESSED_COUNT, 106);
  assert.equal(
    TODO_ITEM_COUNT * TODO_ITEM_METADATA_FIELDS.length,
    400,
  );
  assert.deepEqual(TODO_ITEM_METADATA_FIELDS, [
    "priorityLabel",
    "dueLabel",
    "assigneeLabel",
    "subtaskCountLabel",
  ]);
  assert.deepEqual(CACHE_POLICY_NAMES, {
    REQUEST_TIMESTAMPED_INPUT: "request-timestamped-input",
  });

  assert.equal(
    HEADLINE_CACHE_POLICY,
    CACHE_POLICY_NAMES.REQUEST_TIMESTAMPED_INPUT,
  );
  assert.equal(
    CACHE_POLICIES[CACHE_POLICY_NAMES.REQUEST_TIMESTAMPED_INPUT].finalHtmlCache,
    false,
  );
  assert.equal(
    CACHE_POLICIES[CACHE_POLICY_NAMES.REQUEST_TIMESTAMPED_INPUT]
      .inputSnapshotCount,
    32,
  );
  assert.deepEqual(
    CACHE_POLICIES[CACHE_POLICY_NAMES.REQUEST_TIMESTAMPED_INPUT]
      .inputRepresentation,
    {
      javascript: "request-materialized-object",
      rust: "request-materialized-value",
      webui: "request-materialized-native-input",
    },
  );
  assert.equal(TODO_BENCH_CONTRACT.buttonCount, 101);
  assert.equal(TODO_BENCH_CONTRACT.ariaPressedCount, 106);
});

test("defines the equal routed workspace contract", () => {
  assert.deepEqual(
    APP_ROUTES.map(({ id, path }) => [id, path]),
    [
      ["work", "/dynamic"],
      ["activity", "/activity"],
      ["settings", "/settings"],
    ],
  );
  assert.equal(ACTIVITY_EVENT_COUNT, 48);
  assert.equal(SETTING_CONTROL_COUNT, 8);
  assert.equal(ACTIVITY_SENTINEL_ID, "activity-0026");
  assert.deepEqual(
    ROUTE_INTERACTIONS.map(({ id }) => id),
    [
      "navigate-activity",
      "filter-activity",
      "expand-activity",
      "mark-activity-read",
      "navigate-settings",
      "toggle-setting",
      "select-density",
      "save-settings",
      "navigate-work",
    ],
  );
});

test("defines advanced workspace intelligence interactions", () => {
  assert.deepEqual(
    WORKSPACE_INTERACTIONS.map(({ id }) => id),
    [
      "workspace-search",
      "workspace-filter",
      "workspace-view",
      "workspace-select-all",
      "workspace-row-select",
      "workspace-save-view",
      "workspace-export",
      "workspace-archive",
      "workspace-schedule",
      "workspace-reset",
    ],
  );
});

test("materializes a unique current timestamp into every request todo", () => {
  const now = Date.now();
  const firstTimestamp = currentRequestTimestamp(now);
  const secondTimestamp = currentRequestTimestamp(now);
  assert.notEqual(firstTimestamp, secondTimestamp);
  assert.match(
    firstTimestamp,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u,
  );
  let burstTimestamp = secondTimestamp;
  for (let index = 0; index < 2_000; index += 1) {
    burstTimestamp = currentRequestTimestamp(now);
  }
  assert.ok(
    Date.parse(burstTimestamp) - now < 3,
    "high-throughput uniqueness must not drift wall-clock time by whole seconds",
  );

  const state = createRequestTodoState(createTodoState(0), firstTimestamp);
  assert.equal(state.requestTimestamp, firstTimestamp);
  assert.notStrictEqual(state, createTodoState(0));
  assert.notStrictEqual(state.todos, createTodoState(0).todos);
  assert.equal(new Set(state.todos.map((todo) => todo.title)).size, 100);
  assert.deepEqual(
    new Set(state.todos.map((todo) => todo.timestamp)),
    new Set([firstTimestamp]),
  );
  assert.ok(
    state.todos.every((todo) =>
      todo.title.includes(firstTimestamp)
      && todo.description.includes(firstTimestamp)
    ),
  );
});

test("framework reducers keep footer and selection state valid after clear", async () => {
  for (
    const appId of [
      "react",
      "preact",
      "solid",
      "vue",
      "webui",
      "webui-fast",
    ]
  ) {
    const interactions = await import(`../apps/${appId}/interactions.mjs`);
    const cleared = interactions.clearCompletedTodos(createTodoState(0));
    assert.equal(cleared.todos.length, 75, `${appId} must remove completed todos`);
    assert.equal(cleared.summary.totalCount, 75);
    assert.equal(cleared.footer.itemCountLabel, "75 items");
    assert.equal(cleared.intelligence.resultCount, 75);
    assert.ok(
      cleared.intelligence.previewRows.every(
        ({ completed }) => completed === false,
      ),
      `${appId} must refresh workspace rows after clearing completed todos`,
    );
    assert.equal(cleared.selection.hasSelection, true);
    assert.ok(
      cleared.todos.some(
        (todo) =>
          todo.id === cleared.selection.todoId
          && todo.selected
          && todo.selectionLabel === "Selected",
      ),
      `${appId} must select a remaining todo`,
    );
  }
});

test("FAST declarative templates are excluded from semantic observations", () => {
  const observation = collectHtmlObservation(
    '<main class="todo-app"></main>'
      + '<f-template name="todo-app"><template>'
      + '<main class="todo-app"><li class="todo-item"></li></main>'
      + "</template></f-template>",
  );
  assert.equal(observation.selectorCounts["todo-app"], 1);
  assert.equal(observation.selectorCounts["todo-item"], 0);
});

test("creates 32 immutable deterministic variants of 100 fixed-shape items", () => {
  const variants = createTodoStateVariants();
  assert.equal(variants.length, STATE_VARIANT_COUNT);
  assert.equal(STATE_VARIANT_COUNT, 32);
  assert.equal(TODO_ITEM_COUNT, 100);
  assert.equal(Object.isFrozen(variants), true);
  assert.equal(new Set(variants.map((state) => state.variantId)).size, 32);
  assert.equal(new Set(variants.map((state) => state.selection.todoId)).size, 32);
  assert.notStrictEqual(variants, createTodoStateVariants());
  assert.equal(
    JSON.stringify(variants),
    JSON.stringify(createTodoStateVariants()),
  );

  for (const state of variants) {
    assert.equal(state.todos.length, TODO_ITEM_COUNT);
    assert.deepEqual(Object.keys(state.todos[0]), TODO_ITEM_FIELDS);
    assert.equal(Object.isFrozen(state), true);
    assert.equal(Object.isFrozen(state.todos), true);
    assert.equal(Object.isFrozen(state.todos[0]), true);
    assert.equal(Object.isFrozen(state.todos[0].assignee), true);
    assert.equal(Object.isFrozen(state.todos[0].tags), true);
    assert.equal(Object.isFrozen(state.todos[0].subtasks), true);
    assert.equal(state.activity.events.length, ACTIVITY_EVENT_COUNT);
    assert.equal(state.settings.toggles.length, SETTING_CONTROL_COUNT);
    assert.equal(Object.isFrozen(state.activity.events), true);
    assert.equal(Object.isFrozen(state.settings.toggles), true);
    assert.deepEqual(validateTodoState(state), { valid: true, errors: [] });
  }
  const todos = variants.flatMap((state) => state.todos);
  assert.equal(new Set(todos.map((todo) => todo.title)).size, todos.length);
  assert.equal(new Set(todos.map((todo) => todo.timestamp)).size, todos.length);
  for (const todo of todos) {
    assert.match(todo.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    assert.ok(todo.title.includes(todo.timestamp));
  }

  assert.strictEqual(createTodoState(17), TODO_STATE_VARIANTS[17]);
  assert.equal(
    JSON.stringify(createTodoState(17)),
    JSON.stringify(TODO_STATE_VARIANTS[17]),
  );
  assert.throws(() => createTodoState(-1), RangeError);
  assert.throws(() => createTodoState(32), RangeError);
  assert.throws(() => {
    createTodoState(0).todos[0].title = "mutated";
  }, TypeError);
});

test("routed workspace reducers preserve immutable route state", () => {
  const source = createTodoState(0);
  const deployed = filterActivity(source, "deployment");
  assert.notStrictEqual(deployed, source);
  assert.equal(
    deployed.activity.events.filter((event) => event.visible).length,
    16,
  );
  const expanded = toggleActivityDetail(deployed, ACTIVITY_SENTINEL_ID);
  assert.equal(
    expanded.activity.events.find(
      (event) => event.id === ACTIVITY_SENTINEL_ID,
    ).expanded,
    true,
  );
  assert.equal(markActivityRead(expanded).activity.unreadCount, 0);

  const toggled = toggleSetting(source, "daily-digest");
  assert.equal(
    toggled.settings.toggles.find(
      (setting) => setting.id === "daily-digest",
    ).enabled,
    false,
  );
  const compact = selectDensity(toggled, "compact");
  assert.equal(compact.settings.density, "compact");
  assert.equal(saveSettings(compact).settings.statusLabel, "Preferences saved");
  assert.equal(source.settings.density, "comfortable");
});

test("pins the 12 equivalent branch conditions and derived counts", () => {
  assert.deepEqual(
    BRANCHES.map((branch) => branch.id),
    [
      "completed",
      "pending",
      "high-priority",
      "medium-priority",
      "overdue",
      "due-today",
      "blocked",
      "recurring",
      "assigned",
      "has-tags",
      "has-subtasks",
      "selected",
    ],
  );
  const state = createTodoState(0);
  assert.deepEqual(state.branchCounts, countTodoBranches(state.todos));
  assert.equal(
    state.branchCounts.completed + state.branchCounts.pending,
    TODO_ITEM_COUNT,
  );
  assert.equal(state.branchCounts.selected, 1);
  for (const branch of BRANCHES) {
    assert.ok(
      state.branchCounts[branch.id] > 0,
      `${branch.id} must have true cases`,
    );
  }
});

test("provides stable todo ids, sentinels, and nested tag loop data", () => {
  assert.deepEqual(SENTINEL_IDS, [
    "todo-0001",
    "todo-0050",
    "todo-0100",
  ]);
  assert.deepEqual(
    LOOPS.map((loop) => loop.id),
    ["todo-loop", "tag-loop"],
  );
  assert.equal(LOOPS[1].nestedUnder, "todo-loop");

  const first = createTodoState(0);
  const last = createTodoState(31);
  assert.deepEqual(
    first.todos.map((todo) => todo.id),
    last.todos.map((todo) => todo.id),
  );
  assert.equal(first.todos[0].id, "todo-0001");
  assert.equal(first.todos[49].id, "todo-0050");
  assert.equal(first.todos[99].id, "todo-0100");
  assert.ok(first.todos.some((todo) => todo.tags.length === 0));
  assert.ok(first.todos.some((todo) => todo.tags.length === 2));
  for (const todo of first.todos) {
    for (const tag of todo.tags) {
      assert.match(tag.id, new RegExp(`^${todo.id}-tag-[12]$`));
      assert.equal(typeof tag.label, "string");
      assert.equal(typeof tag.tone, "string");
    }
  }
});

test("pins the complete interaction contract", () => {
  assert.deepEqual(
    INTERACTIONS.map((interaction) => interaction.id),
    ["filter", "select", "toggle-completion", "clear-completed"],
  );
  assert.deepEqual(INTERACTIONS[0].values, ["all", "pending", "completed"]);
  assert.deepEqual(
    createExpectedObservation(createTodoState(0)).interactionCounts,
    {
      "clear-completed": 1,
      filter: 3,
      select: 100,
      "toggle-completion": 100,
    },
  );
  for (const interaction of INTERACTIONS) {
    assert.ok(interaction.selector.startsWith(".") || interaction.selector.startsWith("["));
    assert.ok(interaction.event.length > 0);
    assert.ok(interaction.statePath.length > 0);
    assert.ok(interaction.behavior.length > 0);
  }
});

test("validates normalized semantic observations without an HTML parser", () => {
  const state = createTodoState(7);
  const observation = createExpectedObservation(state);
  assert.deepEqual(validateObservation(observation, state), {
    valid: true,
    errors: [],
  });

  const invalid = {
    ...observation,
    itemIds: observation.itemIds.slice(0, -1),
    selectorCounts: {
      ...observation.selectorCounts,
      "todo-badge": undefined,
    },
    branchCounts: {
      ...observation.branchCounts,
      overdue: observation.branchCounts.overdue + 1,
    },
  };
  const validation = validateObservation(invalid, state);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("100 stable todo ids")));
  assert.ok(validation.errors.some((error) => error.includes("branchCounts.overdue")));
  assert.ok(validation.errors.some((error) => error.includes("todo-badge")));
});
