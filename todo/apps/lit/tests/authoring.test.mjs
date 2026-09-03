// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMPONENTS } from "../../../shared/contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const componentDirectory = resolve(here, "..", "components");

// FAST authoring - TypeScript decorators or `@microsoft/fast-element` - is
// exactly what this row replaced: it must be pure Lit.
const FORBIDDEN_AUTHORING = [
  { label: "@customElement decorator", pattern: /@customElement\b/ },
  { label: "@property decorator", pattern: /@property\b/ },
  { label: "@state decorator", pattern: /@state\b/ },
  { label: "@microsoft/fast-element import", pattern: /@microsoft\/fast-element/ },
];

// `todo-badge` is a slot-only host with no reactive state, so it legitimately
// declares no properties and needs no constructor. Every other component that
// carries reactive properties must also seed their SSR defaults in a
// constructor, which Lit SSR requires.
const NO_PROPERTY_COMPONENTS = new Set(["todo-badge"]);

function readComponent(name) {
  return readFile(resolve(componentDirectory, `${name}.mjs`), "utf8");
}

test("every contract component is a Lit custom element", async () => {
  for (const name of COMPONENTS) {
    const source = await readComponent(name);
    assert.match(
      source,
      /class\s+\w+\s+extends\s+LitElement/,
      `${name}.mjs must define a LitElement subclass`,
    );
    assert.match(
      source,
      new RegExp(`customElements\\.define\\(\\s*"${name}"`),
      `${name}.mjs must register customElements.define("${name}", ...)`,
    );
  }
});

test("no component uses decorators or fast-element", async () => {
  for (const name of COMPONENTS) {
    const source = await readComponent(name);
    for (const { label, pattern } of FORBIDDEN_AUTHORING) {
      assert.equal(
        pattern.test(source),
        false,
        `${name}.mjs must not use ${label}`,
      );
    }
  }
});

test("every stateful component seeds its SSR property defaults", async () => {
  for (const name of COMPONENTS) {
    const source = await readComponent(name);
    if (NO_PROPERTY_COMPONENTS.has(name)) {
      continue;
    }
    assert.match(
      source,
      /static\s+properties\s*=/,
      `${name}.mjs must declare static properties`,
    );
    assert.match(
      source,
      /constructor\s*\(\s*\)\s*\{/,
      `${name}.mjs must default its properties in a constructor`,
    );
  }
});
