// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { SENTINEL_IDS } from "../../../shared/contract.mjs";
import { createTodoState } from "../../../shared/state.mjs";
import {
  clearCompletedTodos,
  toggleTodoCompletion,
  visibleTodos,
} from "../interactions.mjs";
import { createRenderer, metadata } from "../adapter.mjs";
import { APP_ID, bundleHydrationHarness } from "./support.mjs";

const ROOT_SELECTOR = "#todo-browser-root";
const ITEM_SELECTOR = "li.todo-item[data-todo-id]";
const [firstSentinel, middleSentinel] = SENTINEL_IDS;

const state = createTodoState(0);
const renderer = await createRenderer();
const html = renderer.render(state);

const expected = {
  all: state.todos.length,
  completed: visibleTodos({
    ...state,
    toolbar: { ...state.toolbar, activeFilter: "completed" },
  }).length,
  pending: visibleTodos({
    ...state,
    toolbar: { ...state.toolbar, activeFilter: "pending" },
  }).length,
  remainingAfterClear: clearCompletedTodos(
    toggleTodoCompletion(state, firstSentinel),
  ).todos.length,
};

test(`${APP_ID}: the hydration entry bundles for the browser`, async () => {
  const bundle = await bundleHydrationHarness();
  assert.ok(bundle.includes("todoHydrationHarness"));
  assert.ok(bundle.length > 1000, "bundle must contain the framework runtime");
});

test(
  `${APP_ID}: SSR markup hydrates and owns every contract interaction`,
  { skip: !existsSync(chromium.executablePath()), timeout: 120_000 },
  async () => {
    const bundle = await bundleHydrationHarness();
    const browser = await chromium.launch({ headless: true });
    const pageErrors = [];
    try {
      const page = await browser.newPage();
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      const document = `<!doctype html><html><head><meta charset="utf-8"><style>${renderer.css}</style></head><body><div id="todo-browser-root">${html}</div></body></html>`;
      await page.route("http://todo-benchmark.test/dynamic", (route) =>
        route.fulfill({ body: document, contentType: "text/html" })
      );
      await page.goto("http://todo-benchmark.test/dynamic", {
        waitUntil: "load",
      });

      const countItems = () =>
        page.$$eval(`${ROOT_SELECTOR} ${ITEM_SELECTOR}`, (nodes) => nodes.length);

      assert.equal(await countItems(), expected.all, "SSR item count");

      await page.evaluate((todoId) => {
        const node = document.querySelector(`li[data-todo-id="${todoId}"]`);
        node.hydrationProbe = "server-node";
      }, firstSentinel);

      await page.addScriptTag({ content: bundle });
      await page.evaluate((snapshot) => {
        globalThis.todoHydrationHarness.hydrate(snapshot);
      }, state);
      await page.waitForFunction(
        () => globalThis.todoHydrationHarness !== undefined,
      );

      assert.equal(
        await page.evaluate(
          (todoId) =>
            document.querySelector(`li[data-todo-id="${todoId}"]`)
              .hydrationProbe,
          firstSentinel,
        ),
        "server-node",
        "hydration must reuse the server DOM instead of replacing it",
      );
      assert.deepEqual(
        await page.evaluate(
          () => globalThis.todoHydrationHarness.recoverableErrors,
        ),
        [],
        "hydration must not report recoverable mismatches",
      );

      await page.click('[data-action="filter"][data-filter="pending"]');
      await page.waitForFunction(
        ([selector, count]) =>
          document.querySelectorAll(selector).length === count,
        [`${ROOT_SELECTOR} ${ITEM_SELECTOR}`, expected.pending],
      );

      await page.click('[data-action="filter"][data-filter="completed"]');
      await page.waitForFunction(
        ([selector, count]) =>
          document.querySelectorAll(selector).length === count,
        [`${ROOT_SELECTOR} ${ITEM_SELECTOR}`, expected.completed],
      );

      await page.click('[data-action="filter"][data-filter="all"]');
      await page.waitForFunction(
        ([selector, count]) =>
          document.querySelectorAll(selector).length === count,
        [`${ROOT_SELECTOR} ${ITEM_SELECTOR}`, expected.all],
      );

      await page.click(`[data-action="select"][data-todo-id="${middleSentinel}"]`);
      await page.waitForFunction(
        (todoId) =>
          document
            .querySelector(`li[data-todo-id="${todoId}"]`)
            ?.getAttribute("aria-selected") === "true",
        middleSentinel,
      );
      assert.match(
        await page.textContent(".todo-toolbar__selection"),
        new RegExp(middleSentinel, "u"),
      );
      assert.equal(
        await page.$$eval(
          `${ROOT_SELECTOR} todo-badge[data-branch="selected"]`,
          (nodes) => nodes.length,
        ),
        1,
        "exactly one todo may be selected",
      );

      const checkbox = `input.todo-checkbox[data-todo-id="${firstSentinel}"]`;
      const before = await page.isChecked(checkbox);
      await page.click(checkbox);
      await page.waitForFunction(
        ([selector, previous]) =>
          document.querySelector(selector).checked !== previous,
        [checkbox, before],
      );
      assert.equal(await page.isChecked(checkbox), !before);

      await page.click('.todo-button[data-action="clear-completed"]');
      await page.waitForFunction(
        ([selector, count]) =>
          document.querySelectorAll(selector).length === count,
        [`${ROOT_SELECTOR} ${ITEM_SELECTOR}`, expected.remainingAfterClear],
      );
      assert.equal(
        await page.isDisabled('.todo-button[data-action="clear-completed"]'),
        true,
        "clear-completed must disable once nothing is completed",
      );
      assert.equal(
        await page.$$eval(
          `${ROOT_SELECTOR} input.todo-checkbox:checked`,
          (nodes) => nodes.length,
        ),
        0,
      );
    } finally {
      await browser.close();
    }
    assert.deepEqual(pageErrors, [], "hydration must not raise page errors");
  },
);

test(`${APP_ID}: browser entry metadata points at the hydration entry`, () => {
  assert.ok(metadata.browserEntry.endsWith("client.jsx"));
  assert.ok(existsSync(metadata.browserEntry));
});
