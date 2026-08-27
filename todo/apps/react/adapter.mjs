// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMPONENTS } from "../../shared/contract.mjs";
import { createTodoState } from "../../shared/state.mjs";
import { build as buildApp } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const stylesPath = resolve(here, "..", "..", "shared", "styles.css");
const defaultState = createTodoState(0);
let rendererPromise;

export const metadata = Object.freeze({
  async: false,
  browserEntry: resolve(here, "client.jsx"),
  componentNames: COMPONENTS,
  id: "react",
  label: "React",
  stylesPath,
});

export function build() {
  return buildApp();
}

export function createRenderer() {
  rendererPromise ??= build().then(async ({ artifactPath, css }) => {
    const { renderTodo } = await import(pathToFileURL(artifactPath).href);
    return Object.freeze({
      ...metadata,
      css,
      render(state = defaultState, requestPath = "/dynamic") {
        return renderTodo(state, requestPath);
      },
    });
  });
  return rendererPromise;
}
