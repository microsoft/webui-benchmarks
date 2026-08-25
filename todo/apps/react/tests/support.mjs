// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildBundle } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ID = "react";
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Shared contract drift owned by todo/shared, not by this app: shared/state.mjs
 * emits copy that shared/contract.mjs REQUIRED_TEXT has not caught up with yet.
 * Every renderer app in the bench reports exactly these two entries today.
 */
export const SHARED_TEXT_DRIFT = Object.freeze([
  "textCounts.app-subtitle must be at least 1",
  "textCounts.footer must be at least 1",
]);

export function componentPath(componentName) {
  return resolve(APP_ROOT, "components", `${componentName}.jsx`);
}

export function symbolName(componentName) {
  return componentName
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

export async function readAuthoredSources() {
  const sources = new Map();
  const pending = [APP_ROOT];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["dist", "node_modules", "tests"].includes(entry.name)) {
          pending.push(path);
        }
      } else if ([".jsx", ".mjs"].includes(extname(entry.name))) {
        sources.set(path, await readFile(path, "utf8"));
      }
    }
  }
  return sources;
}

export async function bundleHydrationHarness() {
  const result = await buildBundle({
    bundle: true,
    define: { "process.env.NODE_ENV": '"production"' },
    format: "iife",
    globalName: "todoHydrationHarness",
    legalComments: "none",
    platform: "browser",
    stdin: {
      contents: [
        'import { hydrateTodoApp } from "./client.jsx";',
        "export const recoverableErrors = [];",
        "export function hydrate(state) {",
        '  hydrateTodoApp(document.querySelector("#todo-browser-root"), state, {',
        "    onRecoverableError(error) {",
        "      recoverableErrors.push(String(error));",
        "    },",
        "  });",
        "}",
      ].join("\n"),
      loader: "js",
      resolveDir: APP_ROOT,
      sourcefile: "hydration-harness.js",
    },
    target: "chrome120",
    write: false,
  });
  const [output] = result.outputFiles;
  if (output === undefined) {
    throw new Error(`${APP_ID} hydration harness produced no JavaScript`);
  }
  return Buffer.from(output.contents).toString("utf8");
}
