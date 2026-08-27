// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export const TODO_ITEM_COUNT = 100;
export const STATE_VARIANT_COUNT = 32;
export const TODO_BUTTON_COUNT = TODO_ITEM_COUNT + 1;
export const ARIA_PRESSED_COUNT = TODO_ITEM_COUNT + 6;
export const ACTIVITY_EVENT_COUNT = 48;
export const ACTIVITY_SENTINEL_ID = "activity-0026";
export const SETTING_CONTROL_COUNT = 8;

export const APP_ROUTES = Object.freeze([
  Object.freeze({
    id: "work",
    label: "Work queue",
    path: "/dynamic",
  }),
  Object.freeze({
    id: "activity",
    label: "Activity",
    path: "/activity",
  }),
  Object.freeze({
    id: "settings",
    label: "Settings",
    path: "/settings",
  }),
]);

export const ROUTE_INTERACTIONS = Object.freeze([
  Object.freeze({
    id: "navigate-activity",
    path: "/activity",
    selector: '[data-route-link="activity"]',
  }),
  Object.freeze({
    id: "filter-activity",
    selector: '[data-action="activity-filter"][data-filter="deployment"]',
  }),
  Object.freeze({
    id: "expand-activity",
    selector:
      `[data-action="activity-expand"][data-event-id="${ACTIVITY_SENTINEL_ID}"]`,
  }),
  Object.freeze({
    id: "mark-activity-read",
    selector: '[data-action="activity-mark-read"]',
  }),
  Object.freeze({
    id: "navigate-settings",
    path: "/settings",
    selector: '[data-route-link="settings"]',
  }),
  Object.freeze({
    id: "toggle-setting",
    selector: '[data-action="setting-toggle"][data-setting-id="daily-digest"]',
  }),
  Object.freeze({
    id: "select-density",
    selector: '[data-action="setting-density"][data-density="compact"]',
  }),
  Object.freeze({
    id: "save-settings",
    selector: '[data-action="settings-save"]',
  }),
  Object.freeze({
    id: "navigate-work",
    path: "/dynamic",
    selector: '[data-route-link="work"]',
  }),
]);

export const CACHE_POLICY_NAMES = Object.freeze({
  REQUEST_TIMESTAMPED_INPUT: "request-timestamped-input",
});

export const CACHE_POLICIES = Object.freeze({
  [CACHE_POLICY_NAMES.REQUEST_TIMESTAMPED_INPUT]: Object.freeze({
    description:
      "Official policy: materialize current request timestamps, never final HTML",
    finalHtmlCache: false,
    headline: true,
    inputRepresentation: Object.freeze({
      javascript: "request-materialized-object",
      rust: "request-materialized-value",
      webui: "request-materialized-native-input",
    }),
    inputSnapshotCount: STATE_VARIANT_COUNT,
    preparation: "inside-measurement",
  }),
});

export const HEADLINE_CACHE_POLICY =
  CACHE_POLICY_NAMES.REQUEST_TIMESTAMPED_INPUT;

export const COMPONENTS = Object.freeze([
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

export const COMPONENT_GRAPH = Object.freeze({
  "todo-app": Object.freeze([
    "workspace-intelligence",
    "todo-header",
    "todo-summary",
    "todo-toolbar",
    "todo-list",
    "todo-footer",
  ]),
  "workspace-intelligence": Object.freeze([]),
  "todo-header": Object.freeze([]),
  "todo-summary": Object.freeze([]),
  "todo-toolbar": Object.freeze(["todo-filter", "todo-button"]),
  "todo-filter": Object.freeze([]),
  "todo-list": Object.freeze(["todo-item"]),
  "todo-item": Object.freeze([
    "todo-checkbox",
    "todo-badge",
    "todo-tag-list",
    "todo-button",
  ]),
  "todo-checkbox": Object.freeze([]),
  "todo-badge": Object.freeze([]),
  "todo-tag-list": Object.freeze([]),
  "todo-button": Object.freeze([]),
  "todo-footer": Object.freeze([]),
});

export const TODO_ITEM_METADATA_FIELDS = Object.freeze([
  "priorityLabel",
  "dueLabel",
  "assigneeLabel",
  "subtaskCountLabel",
]);

export const TODO_ITEM_FIELDS = Object.freeze([
  "id",
  "title",
  "timestamp",
  "description",
  "completed",
  "pending",
  "priority",
  "isHighPriority",
  "isMediumPriority",
  "overdue",
  "dueToday",
  "blocked",
  "recurring",
  "assigned",
  "assignee",
  "tags",
  "tagCount",
  "hasTags",
  "subtasks",
  "subtaskCount",
  "completedSubtaskCount",
  "hasSubtasks",
  "selected",
  "visible",
  "statusLabel",
  "priorityLabel",
  "dueLabel",
  "blockedLabel",
  "recurringLabel",
  "assigneeLabel",
  "tagCountLabel",
  "subtaskCountLabel",
  "subtaskProgressLabel",
  "selectionLabel",
]);

const branchDefinitions = [
  ["completed", "completed", "Completed"],
  ["pending", "pending", "Pending"],
  ["high-priority", "isHighPriority", "High priority"],
  ["medium-priority", "isMediumPriority", "Medium priority"],
  ["overdue", "overdue", "Overdue"],
  ["due-today", "dueToday", "Due today"],
  ["blocked", "blocked", "Blocked"],
  ["recurring", "recurring", "Recurring"],
  ["assigned", "assigned", "Assigned"],
  ["has-tags", "hasTags", "Has tags"],
  ["has-subtasks", "hasSubtasks", "Has subtasks"],
  ["selected", "selected", "Selected"],
];

export const BRANCHES = Object.freeze(
  branchDefinitions.map(([id, field, label]) =>
    Object.freeze({
      id,
      label,
      condition: Object.freeze({ field, operator: "truthy" }),
      selector: `[data-branch~="${id}"]`,
    }),
  ),
);

export const LOOPS = Object.freeze([
  Object.freeze({
    id: "todo-loop",
    collection: "todos",
    item: "todo",
    parentSelector: ".todo-list",
    itemSelector: ".todo-item[data-todo-id]",
  }),
  Object.freeze({
    id: "tag-loop",
    collection: "todo.tags",
    item: "tag",
    parentSelector: ".todo-tag-list",
    itemSelector: ".todo-tag[data-tag-id]",
    nestedUnder: "todo-loop",
  }),
]);

const count = (kind, value) => Object.freeze({ kind, value });

export const INTERACTIONS = Object.freeze([
  Object.freeze({
    id: "filter",
    component: "todo-filter",
    event: "click",
    selector: '[data-action="filter"][data-filter]',
    statePath: "toolbar.activeFilter",
    values: Object.freeze(["all", "pending", "completed"]),
    behavior: "show items matching the selected filter",
    count: count("metric", "filterCount"),
  }),
  Object.freeze({
    id: "select",
    component: "todo-item",
    event: "click",
    selector: '[data-action="select"][data-todo-id]',
    statePath: "todos[].selected",
    behavior: "select exactly one todo by stable id",
    count: count("metric", "itemCount"),
  }),
  Object.freeze({
    id: "toggle-completion",
    component: "todo-checkbox",
    event: "change",
    selector: '.todo-checkbox[data-action="toggle-completion"]',
    statePath: "todos[].completed",
    behavior: "toggle completed and pending as complementary booleans",
    count: count("metric", "itemCount"),
  }),
  Object.freeze({
    id: "clear-completed",
    component: "todo-toolbar",
    event: "click",
    selector: '.todo-button[data-action="clear-completed"]',
    statePath: "todos",
    behavior: "remove every completed todo from interactive client state",
    count: count("exact", 1),
  }),
]);

export const WORKSPACE_INTERACTIONS = Object.freeze([
  Object.freeze({
    id: "workspace-search",
    event: "input",
    selector: '[data-action="workspace-search"]',
  }),
  Object.freeze({
    id: "workspace-filter",
    event: "change",
    selector: '[data-action="workspace-filter"]',
  }),
  Object.freeze({
    id: "workspace-view",
    event: "click",
    selector: '[data-action="workspace-view"]',
  }),
  Object.freeze({
    id: "workspace-select-all",
    event: "click",
    selector: '[data-action="workspace-select-all"]',
  }),
  Object.freeze({
    id: "workspace-row-select",
    event: "change",
    selector: '[data-action="workspace-row-select"][data-todo-id]',
  }),
  Object.freeze({
    id: "workspace-save-view",
    event: "click",
    selector: '[data-action="workspace-save-view"]',
  }),
  Object.freeze({
    id: "workspace-export",
    event: "click",
    selector: '[data-action="workspace-export"]',
  }),
  Object.freeze({
    id: "workspace-archive",
    event: "click",
    selector: '[data-action="workspace-archive"]',
  }),
  Object.freeze({
    id: "workspace-schedule",
    event: "change",
    selector: '[data-action="workspace-schedule"]',
  }),
  Object.freeze({
    id: "workspace-reset",
    event: "click",
    selector: '[data-action="workspace-reset"]',
  }),
]);

export const SELECTORS = Object.freeze([
  Object.freeze({ id: "todo-app", selector: ".todo-app", count: count("exact", 1) }),
  Object.freeze({
    id: "workspace-intelligence",
    selector: ".workspace-intelligence",
    count: count("exact", 1),
  }),
  Object.freeze({ id: "todo-header", selector: ".todo-header", count: count("exact", 1) }),
  Object.freeze({ id: "todo-summary", selector: ".todo-summary", count: count("exact", 1) }),
  Object.freeze({ id: "todo-toolbar", selector: ".todo-toolbar", count: count("exact", 1) }),
  Object.freeze({ id: "todo-filter", selector: ".todo-filter", count: count("metric", "filterCount") }),
  Object.freeze({ id: "todo-list", selector: ".todo-list", count: count("exact", 1) }),
  Object.freeze({
    id: "todo-item",
    selector: ".todo-item[data-todo-id]",
    count: count("metric", "itemCount"),
  }),
  Object.freeze({
    id: "todo-checkbox",
    selector: ".todo-checkbox",
    count: count("metric", "itemCount"),
  }),
  Object.freeze({
    id: "todo-badge",
    selector: ".todo-badge",
    count: count("metric", "badgeCount"),
  }),
  Object.freeze({
    id: "todo-tag-list",
    selector: ".todo-tag-list",
    count: count("metric", "itemCount"),
  }),
  Object.freeze({
    id: "todo-button",
    selector: ".todo-button",
    count: count("metric", "buttonCount"),
  }),
  Object.freeze({ id: "todo-footer", selector: ".todo-footer", count: count("exact", 1) }),
  Object.freeze({
    id: "todo-tag",
    selector: ".todo-tag[data-tag-id]",
    count: count("metric", "tagCount"),
  }),
  Object.freeze({
    id: "todo-toolbar-selection",
    selector: ".todo-toolbar__selection",
    count: count("exact", 1),
  }),
  Object.freeze({
    id: "todo-item-meta",
    selector: ".todo-item__meta",
    count: count("metric", "itemCount"),
  }),
  Object.freeze({
    id: "todo-item-meta-span",
    selector: ".todo-item__meta > span",
    count: count("metric", "metadataCount"),
  }),
  Object.freeze({
    id: "aria-pressed",
    selector: "[aria-pressed]",
    count: count("metric", "ariaPressedCount"),
  }),
]);

export const REQUIRED_TEXT = Object.freeze([
  Object.freeze({ id: "app-title", text: "SSR Todo Benchmark", minimum: 1 }),
  Object.freeze({ id: "app-subtitle", text: "100 timestamped dynamic items", minimum: 1 }),
  Object.freeze({ id: "all-filter", text: "All", minimum: 1 }),
  Object.freeze({ id: "pending-filter", text: "Pending", minimum: 1 }),
  Object.freeze({ id: "completed-filter", text: "Completed", minimum: 1 }),
  Object.freeze({ id: "clear-completed", text: "Clear completed", minimum: 1 }),
  Object.freeze({ id: "footer", text: "Reproducible dynamic todo contract", minimum: 1 }),
]);

export const SENTINEL_IDS = Object.freeze([
  "todo-0001",
  "todo-0050",
  "todo-0100",
]);

export const FILTER_IDS = Object.freeze(["all", "pending", "completed"]);

export function countTodoBranches(todos) {
  const counts = Object.fromEntries(BRANCHES.map((branch) => [branch.id, 0]));
  for (const todo of todos) {
    for (const branch of BRANCHES) {
      if (todo[branch.condition.field]) {
        counts[branch.id] += 1;
      }
    }
  }
  return Object.freeze(counts);
}

export const TODO_BENCH_CONTRACT = Object.freeze({
  schema: "webui.ssr-todo-bench/v1",
  routes: APP_ROUTES,
  routeInteractions: ROUTE_INTERACTIONS,
  activityEventCount: ACTIVITY_EVENT_COUNT,
  settingControlCount: SETTING_CONTROL_COUNT,
  itemCount: TODO_ITEM_COUNT,
  variantCount: STATE_VARIANT_COUNT,
  buttonCount: TODO_BUTTON_COUNT,
  ariaPressedCount: ARIA_PRESSED_COUNT,
  cachePolicyNames: CACHE_POLICY_NAMES,
  cachePolicies: CACHE_POLICIES,
  headlineCachePolicy: HEADLINE_CACHE_POLICY,
  components: COMPONENTS,
  componentGraph: COMPONENT_GRAPH,
  itemFields: TODO_ITEM_FIELDS,
  itemMetadataFields: TODO_ITEM_METADATA_FIELDS,
  branches: BRANCHES,
  loops: LOOPS,
  interactions: INTERACTIONS,
  workspaceInteractions: WORKSPACE_INTERACTIONS,
  selectors: SELECTORS,
  requiredText: REQUIRED_TEXT,
  sentinelIds: SENTINEL_IDS,
});
