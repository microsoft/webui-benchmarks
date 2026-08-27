// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  CANONICAL_INTERACTION_STEP_IDS,
  executeTodoInteractionSequence,
} from "../interactions.mjs";

function fixtureHtml() {
  const items = Array.from({ length: 100 }, (_, index) => {
    const id = `todo-${String(index + 1).padStart(4, "0")}`;
    const completed = index % 2 === 0;
    const branch = completed ? "completed" : "pending";
    return [
      `<li aria-selected="false" class="todo-item" data-todo-id="${id}">`,
      `<input class="todo-checkbox" data-action="toggle-completion" data-todo-id="${id}" type="checkbox"${completed ? " checked" : ""}>`,
      `<div class="todo-item__badges"><span class="todo-badge" data-branch="${branch}">${branch}</span></div>`,
      `<button aria-pressed="false" data-action="select" data-todo-id="${id}">Select</button>`,
      "</li>",
    ].join("");
  }).join("");
  const activity = Array.from({ length: 48 }, (_, index) => {
    const id = `activity-${String(index + 1).padStart(4, "0")}`;
    const type = ["review", "deployment", "automation"][index % 3];
    const label = {
      automation: "Automation",
      deployment: "Deployment",
      review: "Review",
    }[type];
    return [
      `<li class="activity-event" data-event-id="${id}" data-type="${type}" data-unread>`,
      `<button aria-expanded="false" class="activity-event__toggle" data-action="activity-expand" data-event-id="${id}">`,
      `<span class="activity-event__type">${label}</span>`,
      `<strong>Owner updated Todo</strong><time>Now</time></button>`,
      "</li>",
    ].join("");
  }).join("");
  return [
    '<div class="workspace-shell">',
    '<nav aria-label="Workspace">',
    '<a data-route-link="work" href="/dynamic">Work queue</a>',
    '<a data-route-link="activity" href="/activity">Activity</a>',
    '<a data-route-link="settings" href="/settings">Settings</a>',
    "</nav>",
    '<div data-fixture-route="work">',
    '<main class="todo-app" data-route-page="work">',
    '<section class="todo-summary">',
    ...Array.from(
      { length: 5 },
      () =>
        '<article class="todo-summary__metric"><span>x</span><strong>0</strong><small>x</small></article>',
    ),
    "</section>",
    '<section class="todo-toolbar">',
    '<button aria-pressed="true" class="todo-filter" data-action="filter" data-active data-filter="all">All</button>',
    '<button aria-pressed="false" class="todo-filter" data-action="filter" data-filter="pending">Pending</button>',
    '<button aria-pressed="false" class="todo-filter" data-action="filter" data-filter="completed">Completed</button>',
    '<span class="todo-toolbar__selection">No todo selected</span>',
    '<button class="todo-button" data-action="clear-completed">Clear completed</button>',
    "</section>",
    '<section class="workspace-intelligence" data-archived-count="0" data-export-rows="0" data-result-count="100" data-saved-view-count="0" data-selected-count="0" data-workspace-schedule="weekdays" data-workspace-view="table">',
    '<input data-action="workspace-search" type="search">',
    '<select data-action="workspace-filter" data-facet="status"><option value="all">Any status</option><option value="pending">Pending</option></select>',
    '<select data-action="workspace-filter" data-facet="priority"><option value="all">Any priority</option><option value="low">Low</option></select>',
    '<select data-action="workspace-filter" data-facet="assignment"><option value="all">Any owner</option><option value="unassigned">Unassigned</option></select>',
    '<select data-action="workspace-filter" data-facet="sort"><option value="priority">Priority</option><option value="title">Title</option></select>',
    '<button data-action="workspace-view" data-view="board">Board</button>',
    '<button data-action="workspace-view" data-view="insights">Insights</button>',
    '<button data-action="workspace-export">Export CSV</button>',
    '<button data-action="workspace-save-view">Save view</button>',
    '<button data-action="workspace-archive">Archive selected</button>',
    '<button data-action="workspace-reset">Reset</button>',
    '<div data-workspace-panel="table"><table><tbody><tr data-assignment="unassigned" data-priority="low" data-status="pending" data-workspace-row="todo-0050"><td><input data-action="workspace-row-select" data-todo-id="todo-0050" type="checkbox"></td></tr></tbody></table></div>',
    '<div data-workspace-panel="board"></div>',
    '<div data-workspace-panel="insights"></div>',
    '<select data-action="workspace-schedule"><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option></select>',
    "</section>",
    `<ul class="todo-list">${items}</ul>`,
    '<footer class="todo-footer"><span>Todo benchmark</span><span>100 items</span></footer>',
    "</main>",
    "</div>",
    '<section class="workspace-page activity-page" data-route-page="activity" data-route-ready hidden>',
    '<button data-action="activity-mark-read">Mark all read</button>',
    '<button aria-pressed="true" data-action="activity-filter" data-filter="all">All activity</button>',
    '<button aria-pressed="false" data-action="activity-filter" data-filter="review">Reviews</button>',
    '<button aria-pressed="false" data-action="activity-filter" data-filter="deployment">Deployments</button>',
    '<button aria-pressed="false" data-action="activity-filter" data-filter="automation">Automation</button>',
    `<ol class="activity-list">${activity}</ol>`,
    "</section>",
    '<section class="workspace-page settings-page" data-density="comfortable" data-route-page="settings" data-route-ready hidden>',
    '<button aria-pressed="false" data-action="setting-density" data-density="compact">Compact</button>',
    '<label><input checked data-action="setting-toggle" data-setting-id="daily-digest" type="checkbox">Daily digest</label>',
    '<span class="settings-status">No unsaved changes</span>',
    '<button data-action="settings-save" disabled>Save preferences</button>',
    "</section>",
    "</div>",
  ].join("");
}

function installFixtureInteractions() {
  const root = document.querySelector(".todo-app");
  const originalWork = root.cloneNode(true);
  const routePages = () =>
    Array.from(document.querySelectorAll("[data-route-page]"));
  const items = () =>
    Array.from(root.querySelectorAll(".todo-item[data-todo-id]"));
  const checkbox = (item) => item.querySelector(".todo-checkbox");
  const applyFilter = (filterId) => {
    for (const button of root.querySelectorAll(".todo-filter")) {
      const active = button.dataset.filter === filterId;
      button.setAttribute("aria-pressed", String(active));
      button.toggleAttribute("data-active", active);
    }
    for (const item of items()) {
      const completed = checkbox(item).checked;
      item.hidden = filterId === "pending"
        ? completed
        : filterId === "completed"
          ? !completed
          : false;
    }
  };
  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (action.dataset.action === "filter") {
      applyFilter(action.dataset.filter);
    } else if (action.dataset.action === "select") {
      for (const item of items()) {
        const selected = item.dataset.todoId === action.dataset.todoId;
        item.setAttribute("aria-selected", String(selected));
      }
      root.querySelector(".todo-toolbar__selection").textContent =
        `Selected ${action.dataset.todoId}`;
    } else if (action.dataset.action === "clear-completed") {
      for (const item of items()) {
        if (checkbox(item).checked) {
          item.remove();
        }
      }
      const remaining = items();
      const selected = remaining.find(
        (item) => item.getAttribute("aria-selected") === "true",
      ) ?? remaining[0];
      for (const item of remaining) {
        item.setAttribute("aria-selected", String(item === selected));
      }
      root.querySelector(".todo-toolbar__selection").textContent =
        `Selected ${selected.dataset.todoId}`;
      root.querySelector(".todo-footer span:last-child").textContent =
        `${remaining.length} items`;
      root.querySelector(".workspace-intelligence").dataset.resultCount =
        String(remaining.length);
      action.disabled = true;
    }
  });
  root.addEventListener("change", (event) => {
    if (!event.target.matches(".todo-checkbox")) {
      return;
    }
    const item = event.target.closest(".todo-item");
    const branch = event.target.checked ? "completed" : "pending";
    const badge = item.querySelector(".todo-badge");
    badge.dataset.branch = branch;
    badge.textContent = branch;
  });
  document.addEventListener("click", (event) => {
    const routeLink = event.target.closest("[data-route-link]");
    if (routeLink !== null) {
      event.preventDefault();
      if (routeLink.dataset.routeLink === "work") {
        document.querySelector('[data-route-page="work"]').replaceWith(
          originalWork,
        );
      }
      for (const page of routePages()) {
        page.hidden = page.dataset.routePage !== routeLink.dataset.routeLink;
      }
      return;
    }
    const action = event.target.closest("[data-action]");
    const workspace = document.querySelector(".workspace-intelligence");
    if (action?.dataset.action === "workspace-row-select") {
      workspace.dataset.selectedCount = "1";
    } else if (action?.dataset.action === "workspace-export") {
      workspace.dataset.exportRows = "1";
    } else if (action?.dataset.action === "workspace-save-view") {
      workspace.dataset.savedViewCount = "1";
    } else if (action?.dataset.action === "workspace-archive") {
      workspace.dataset.archivedCount = "1";
      workspace.dataset.resultCount = "0";
      workspace.dataset.selectedCount = "0";
    } else if (action?.dataset.action === "workspace-reset") {
      workspace.dataset.archivedCount = "0";
      workspace.dataset.exportRows = "0";
      workspace.dataset.resultCount = "100";
      workspace.dataset.savedViewCount = "0";
      workspace.dataset.selectedCount = "0";
      workspace.dataset.workspaceSchedule = "weekdays";
      workspace.dataset.workspaceView = "table";
    } else if (action?.dataset.action === "workspace-view") {
      workspace.dataset.workspaceView = action.dataset.view;
    } else if (action?.dataset.action === "activity-filter") {
      const filter = action.dataset.filter;
      for (
        const button of document.querySelectorAll(
          '[data-action="activity-filter"]',
        )
      ) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.filter === filter),
        );
      }
      for (const item of document.querySelectorAll(".activity-event")) {
        item.hidden = filter !== "all" && item.dataset.type !== filter;
      }
    } else if (action?.dataset.action === "activity-expand") {
      action.setAttribute("aria-expanded", "true");
      const detail = document.createElement("p");
      detail.className = "activity-event__detail";
      detail.textContent = "Expanded activity detail";
      action.parentElement.append(detail);
    } else if (action?.dataset.action === "activity-mark-read") {
      for (const item of document.querySelectorAll(".activity-event")) {
        item.removeAttribute("data-unread");
      }
      action.disabled = true;
    } else if (action?.dataset.action === "setting-density") {
      for (
        const button of document.querySelectorAll(
          '[data-action="setting-density"]',
        )
      ) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.density === action.dataset.density),
        );
      }
      document.querySelector(".settings-page").dataset.density =
        action.dataset.density;
      document.querySelector('[data-action="settings-save"]').disabled = false;
    } else if (action?.dataset.action === "settings-save") {
      action.disabled = true;
      document.querySelector(".settings-status").textContent =
        "Preferences saved";
    }
  });
  document.addEventListener("change", (event) => {
    const workspace = document.querySelector(".workspace-intelligence");
    if (event.target.matches('[data-action="workspace-schedule"]')) {
      workspace.dataset.workspaceSchedule = event.target.value;
    } else if (event.target.matches('[data-action="setting-toggle"]')) {
      document.querySelector('[data-action="settings-save"]').disabled = false;
      document.querySelector(".settings-status").textContent =
        "Unsaved changes";
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches('[data-action="workspace-search"]')) {
      document.querySelector(".workspace-intelligence").dataset.resultCount =
        event.target.value === "Todo 0050" ? "1" : "100";
    }
  });
}

test(
  "times and validates the finalized interaction sequence in Chromium",
  { skip: !existsSync(chromium.executablePath()), timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(fixtureHtml());
      await page.evaluate(installFixtureInteractions);
      const result = await page.evaluate(
        executeTodoInteractionSequence,
        { sentinelId: "todo-0050", timeoutMs: 5_000 },
      );
      assert.deepEqual(
        Object.keys(result.durations),
        CANONICAL_INTERACTION_STEP_IDS,
      );
      assert.equal(result.evidence.selectedSentinel, "todo-0050");
      assert.equal(
        result.evidence.remainingAfterClear,
        100 - result.evidence.completedBeforeClear,
      );
      assert.ok(result.totalDurationMs > 0);
      assert.equal(result.evidence.activityEvents, 48);
      assert.equal(result.evidence.activityVisibleAfterFilter, 16);
      assert.equal(result.evidence.settingsSaved, true);
      assert.equal(result.evidence.workItemsAfterReturn, 100);
      assert.equal(result.evidence.workspaceArchived, 1);
      assert.equal(result.evidence.workspaceExportRows, 1);
      assert.equal(result.evidence.workspaceSavedViews, 1);
      assert.deepEqual(result.evidence.workspaceViews, ["board", "insights"]);
    } finally {
      await page.close();
      await browser.close();
    }
  },
);
