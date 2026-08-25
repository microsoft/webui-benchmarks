// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { executeTodoInteractionSequence } from "../interactions.mjs";

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
  return [
    '<main class="todo-app">',
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
    `<ul class="todo-list">${items}</ul>`,
    '<footer class="todo-footer"><span>Todo benchmark</span><span>100 items</span></footer>',
    "</main>",
  ].join("");
}

function installFixtureInteractions() {
  const root = document.querySelector(".todo-app");
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
      assert.deepEqual(Object.keys(result.durations), [
        "filterPendingMs",
        "filterCompletedMs",
        "filterAllMs",
        "selectSentinelMs",
        "toggleCompletionMs",
        "clearCompletedMs",
      ]);
      assert.equal(result.evidence.selectedSentinel, "todo-0050");
      assert.equal(
        result.evidence.remainingAfterClear,
        100 - result.evidence.completedBeforeClear,
      );
      assert.ok(result.totalDurationMs > 0);
    } finally {
      await page.close();
      await browser.close();
    }
  },
);
