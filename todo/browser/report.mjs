// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BASELINE_ROOT } from "../runner/lib/paths.mjs";
import { assertBrowserReport } from "./schema.mjs";

export function defaultReportPath(mode) {
  return resolve(
    BASELINE_ROOT,
    `ssr-todo-browser-outcomes-${mode}.json`,
  );
}

export async function writeBrowserReport(report, outputPath) {
  assertBrowserReport(report);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}
