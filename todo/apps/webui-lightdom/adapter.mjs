// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Protocol } from "@microsoft/webui";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS } from "../../shared/contract.mjs";
import { createTodoState } from "../../shared/state.mjs";
import { createWebuiRenderState } from "../../shared/webui-state.mjs";
import { build as buildApp } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const stylesPath = resolve(here, "..", "..", "shared", "styles.css");
const defaultState = createTodoState(0);
let rendererPromise;

export const metadata = Object.freeze({
  async: false,
  browserEntry: resolve(here, "browser-entry.ts"),
  componentNames: COMPONENTS,
  dom: "light",
  id: "webui",
  label: "WebUI",
  stylesPath,
});

export function build() {
  return buildApp();
}

export function createRenderer() {
  rendererPromise ??= build().then(({ css, protocol, protocolPath }) => {
    const runtimeProtocol = new Protocol(protocol, { plugin: "webui" });
    return Object.freeze({
      ...metadata,
      css,
      protocolPath,
      render(state = defaultState, requestPath = "/dynamic") {
        return runtimeProtocol.render(
          createWebuiRenderState(state),
          { requestPath },
        ).toString("utf8");
      },
    });
  });
  return rendererPromise;
}
