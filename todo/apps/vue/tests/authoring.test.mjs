// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  COMPONENT_GRAPH,
  COMPONENTS,
  INTERACTIONS,
} from "../../../shared/contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(here, "..");
const componentDirectory = resolve(appDirectory, "components");

// `defineComponent` + `h()` render-function trees are exactly what this app
// replaced: the benchmark only measures idiomatic Vue when the source is SFCs.
const FORBIDDEN_AUTHORING = [
  { label: "defineComponent(", pattern: /\bdefineComponent\s*\(/ },
  { label: "h(...) render call", pattern: /(^|[^.\w])h\s*\(/m },
  { label: "createVNode(", pattern: /\bcreateVNode\s*\(/ },
  { label: "createElementVNode(", pattern: /\bcreateElementVNode\s*\(/ },
  { label: "render() option", pattern: /\brender\s*\(\s*\)\s*\{/ },
  { label: "h import from vue", pattern: /import\s*\{[^}]*\bh\b[^}]*\}\s*from/ },
];

function componentPath(name) {
  return resolve(componentDirectory, `${name}.vue`);
}

function pascalCase(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function readComponent(name) {
  return readFile(componentPath(name), "utf8");
}

async function readAuthoredSources() {
  const entries = await readdir(componentDirectory);
  const sources = new Map();
  for (const entry of entries) {
    sources.set(
      entry,
      await readFile(resolve(componentDirectory, entry), "utf8"),
    );
  }
  for (const entry of ["adapter.mjs", "build.mjs", "client.mjs", "server.mjs"]) {
    sources.set(entry, await readFile(resolve(appDirectory, entry), "utf8"));
  }
  return sources;
}

test("every contract component is authored as a single file component", async () => {
  const entries = await readdir(componentDirectory);
  const authored = new Set(entries);
  for (const component of COMPONENTS) {
    assert.ok(
      authored.has(`${component}.vue`),
      `components/ must contain ${component}.vue`,
    );
  }
});

test("each single file component uses <template> and <script setup>", async () => {
  for (const name of [
    ...COMPONENTS,
    "activity-page",
    "settings-page",
    "workspace-app",
  ]) {
    const source = await readComponent(name);
    assert.match(source, /<script setup>/, `${name}.vue needs <script setup>`);
    assert.match(source, /<\/script>/, `${name}.vue needs a closed script`);
    assert.match(source, /<template>/, `${name}.vue needs <template>`);
    assert.match(source, /<\/template>/, `${name}.vue needs a closed template`);
    if (!COMPONENTS.includes(name)) {
      continue;
    }
    assert.match(
      source,
      new RegExp(`<${name}[\\s>]`),
      `${name}.vue must render its <${name}> host element`,
    );
    assert.match(
      source,
      new RegExp(`data-component="${name}"`),
      `${name}.vue must carry data-component="${name}"`,
    );
  }
});

test("no source uses render-function authoring", async () => {
  const sources = await readAuthoredSources();
  for (const [file, source] of sources) {
    for (const { label, pattern } of FORBIDDEN_AUTHORING) {
      assert.equal(
        pattern.test(source),
        false,
        `${file} must not use ${label}`,
      );
    }
  }
});

test("the component graph matches the shared contract", async () => {
  for (const [parent, children] of Object.entries(COMPONENT_GRAPH)) {
    const source = await readComponent(parent);
    for (const child of children) {
      const tag = pascalCase(child);
      assert.match(
        source,
        new RegExp(`from "\\./${child}\\.vue"`),
        `${parent}.vue must import ${child}.vue`,
      );
      assert.match(
        source,
        new RegExp(
          `<${
            parent === "todo-list" && child === "todo-item"
              ? "LazyTodoItem"
              : tag
          }[\\s/>]`,
        ),
        `${parent}.vue must render ${child} in its template`,
      );
    }
  }
});

test("templates declare the contract conditionals and loops", async () => {
  const item = await readComponent("todo-item");
  assert.ok(
    [...item.matchAll(/v-(?:if|else-if|else)/g)].length >= 8,
    "todo-item.vue must keep every conditional badge branch",
  );
  assert.match(
    await readComponent("todo-list"),
    /v-for="todo in todos"/,
    "todo-list.vue must loop over todos",
  );
  assert.match(
    await readComponent("todo-tag-list"),
    /v-for=/,
    "todo-tag-list.vue must loop over tags",
  );
  assert.match(
    await readComponent("todo-toolbar"),
    /v-for="filter in toolbar\.filters"/,
    "todo-toolbar.vue must loop over filters",
  );
});

test("every contract interaction is wired reactively in the templates", async () => {
  const app = await readComponent("todo-app");
  const sources = new Map();
  for (const name of COMPONENTS) {
    sources.set(name, await readComponent(name));
  }
  for (const interaction of INTERACTIONS) {
    // The action lives on whichever element renders it: `todo-button` renders
    // `select`/`clear-completed` on behalf of its owner via the `action` prop.
    const rendered = [...sources].filter(([, source]) =>
      new RegExp(`data-action="${interaction.id}"`).test(source)
        || new RegExp(`\\baction="${interaction.id}"`).test(source)
    );
    assert.ok(
      rendered.length > 0,
      `no template renders data-action="${interaction.id}"`,
    );
    const owner = sources.get(interaction.component);
    assert.ok(
      owner.includes(interaction.id),
      `${interaction.component}.vue must reference the ${interaction.id} interaction`,
    );
    const bound = [...sources].some(([, source]) =>
      /:?data-action=/.test(source)
      && new RegExp(`@${interaction.event}[.=]`).test(source)
    );
    assert.ok(
      bound,
      `an actionable element must bind @${interaction.event} for ${interaction.id}`,
    );
  }
  for (const handler of ["applyFilter", "select", "toggle", "clearCompleted"]) {
    assert.match(
      app,
      new RegExp(`function ${handler}\\(`),
      `todo-app.vue must own the ${handler} state transition`,
    );
  }
  assert.match(
    app,
    /from "vue"/,
    "todo-app.vue must import its reactivity primitives from vue",
  );
  assert.match(app, /shallowRef\(/, "todo-app.vue must hold reactive state");
  assert.match(app, /computed\(/, "todo-app.vue must derive visible todos");
});

test("authored sources carry the license header", async () => {
  const sources = await readAuthoredSources();
  for (const [file, source] of sources) {
    const comment = file.endsWith(".vue") ? "<!--" : "//";
    assert.ok(
      source.startsWith(`${comment} Copyright (c) Microsoft Corporation.`),
      `${file} must start with the copyright header`,
    );
  }
});
