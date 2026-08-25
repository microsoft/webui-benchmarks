// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRenderer, nextTick } from "vue";
import { build } from "../build.mjs";
import { FILTER_IDS, TODO_ITEM_COUNT } from "../../../shared/contract.mjs";
import { createTodoState } from "../../../shared/state.mjs";

const { componentsArtifactPath } = await build();
const { TodoApp } = await import(`file://${componentsArtifactPath}`);

// Node has no DOM, so the client components are mounted through a minimal
// custom Vue renderer: the reactivity, template output, and event bindings
// under test are exactly the ones the browser bundle ships.
function createElement(tag) {
  return { tag, props: {}, children: [], parent: null, text: null };
}

function insert(child, parent, anchor) {
  child.parent = parent;
  const index = anchor ? parent.children.indexOf(anchor) : -1;
  if (index === -1) {
    parent.children.push(child);
  } else {
    parent.children.splice(index, 0, child);
  }
}

const { createApp } = createRenderer({
  createComment: (text) => ({ tag: "#comment", props: {}, children: [], parent: null, text }),
  createElement,
  createText: (text) => ({ tag: "#text", props: {}, children: [], parent: null, text }),
  insert,
  nextSibling(node) {
    const siblings = node.parent?.children;
    return siblings?.[siblings.indexOf(node) + 1] ?? null;
  },
  parentNode: (node) => node.parent ?? null,
  patchProp(element, key, _previous, next) {
    if (next === null || next === undefined || next === false) {
      delete element.props[key];
      return;
    }
    element.props[key] = next;
  },
  querySelector: () => null,
  remove(child) {
    const siblings = child.parent?.children;
    if (siblings === undefined) return;
    const index = siblings.indexOf(child);
    if (index !== -1) siblings.splice(index, 1);
    child.parent = null;
  },
  setElementText(node, text) {
    node.children = [];
    node.text = text;
  },
  setScopeId: () => {},
  setText: (node, text) => {
    node.text = text;
  },
});

function walk(root) {
  const nodes = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    nodes.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }
  return nodes;
}

function findAll(root, predicate) {
  return walk(root).filter((node) => predicate(node.props, node));
}

function textOf(node) {
  let text = "";
  for (const current of walk(node)) {
    if (current.text !== null && current.tag !== "#comment") {
      text += current.text;
    }
  }
  return text;
}

async function mountTodoApp(variant = 0) {
  const container = createElement("#root");
  const app = createApp(TodoApp, { state: createTodoState(variant) });
  app.mount(container);
  for (let turn = 0; turn < 2; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await nextTick();
  }
  return { app, container };
}

function itemCount(container) {
  return findAll(container, (props) => props["data-component"] === "todo-item")
    .length;
}

async function fire(node, handler, event = {}) {
  node.props[handler]({ stopPropagation: () => {}, ...event });
  await nextTick();
}

test("the mounted app renders the full todo graph", async () => {
  const { app, container } = await mountTodoApp();
  assert.equal(itemCount(container), TODO_ITEM_COUNT);
  assert.equal(
    findAll(container, (props) => props["data-action"] === "filter").length,
    FILTER_IDS.length,
  );
  app.unmount();
});

test("clicking a filter reactively narrows the visible todos", async () => {
  const { app, container } = await mountTodoApp();
  const total = itemCount(container);
  const [pending] = findAll(
    container,
    (props) => props["data-filter"] === "pending",
  );
  await fire(pending, "onClick");
  const pendingCount = itemCount(container);
  assert.ok(pendingCount > 0 && pendingCount < total, "pending filter is inert");
  assert.equal(pending.props["aria-pressed"], "true");

  const [completed] = findAll(
    container,
    (props) => props["data-filter"] === "completed",
  );
  await fire(completed, "onClick");
  assert.equal(itemCount(container), total - pendingCount);

  const [all] = findAll(container, (props) => props["data-filter"] === "all");
  await fire(all, "onClick");
  assert.equal(itemCount(container), total);
  app.unmount();
});

test("selecting a todo reactively moves the selection", async () => {
  const { app, container } = await mountTodoApp();
  const buttons = findAll(
    container,
    (props) => props["data-action"] === "select",
  );
  const target = buttons[3];
  const todoId = target.props["data-todo-id"];
  assert.equal(target.props["aria-pressed"], "false");
  await fire(target, "onClick");

  const selected = findAll(
    container,
    (props) =>
      props["data-action"] === "select" && props["aria-pressed"] === "true",
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].props["data-todo-id"], todoId);

  const [selection] = findAll(
    container,
    (props) => props.class === "todo-toolbar__selection",
  );
  assert.equal(textOf(selection), `Selected ${todoId}`);
  app.unmount();
});

test("toggling a checkbox reactively updates completion and counts", async () => {
  const { app, container } = await mountTodoApp();
  const [checkbox] = findAll(
    container,
    (props) => props["data-action"] === "toggle-completion",
  );
  const todoId = checkbox.props["data-todo-id"];
  const wasChecked = checkbox.props.checked === true;
  const [completedFilter] = findAll(
    container,
    (props) => props["data-filter"] === "completed",
  );
  const before = Number(textOf(completedFilter).replace(/\D+/gu, ""));

  await fire(checkbox, "onChange");

  const [after] = findAll(
    container,
    (props) =>
      props["data-action"] === "toggle-completion"
      && props["data-todo-id"] === todoId,
  );
  assert.equal(after.props.checked === true, !wasChecked);
  const [refreshed] = findAll(
    container,
    (props) => props["data-filter"] === "completed",
  );
  assert.equal(
    Number(textOf(refreshed).replace(/\D+/gu, "")),
    wasChecked ? before - 1 : before + 1,
  );
  app.unmount();
});

test("clearing completed todos reactively removes them", async () => {
  const { app, container } = await mountTodoApp();
  const total = itemCount(container);
  const completed = findAll(
    container,
    (props) => props["data-action"] === "toggle-completion" && props.checked,
  ).length;
  assert.ok(completed > 0, "fixture must start with completed todos");

  const [clear] = findAll(
    container,
    (props) => props["data-action"] === "clear-completed",
  );
  assert.notEqual(clear.props.disabled, true);
  await fire(clear, "onClick");

  assert.equal(itemCount(container), total - completed);
  assert.equal(
    findAll(
      container,
      (props) => props["data-action"] === "toggle-completion" && props.checked,
    ).length,
    0,
  );
  const [again] = findAll(
    container,
    (props) => props["data-action"] === "clear-completed",
  );
  assert.equal(again.props.disabled, true);
  app.unmount();
});
