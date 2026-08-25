// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { isMainModule } from "../servers/lib/cli.mjs";
import { createBuildPlan, runBuildPlan } from "./lib/builds.mjs";
import { createCaseMatrix, filterCases } from "./lib/cases.mjs";
import { parseOptions } from "./lib/options.mjs";
import {
  ProcessRegistry,
  installProcessCleanup,
} from "./lib/process-tree.mjs";

export async function buildTodoBenchmark(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const cases = filterCases(createCaseMatrix(), options.caseFilters);
  const registry = new ProcessRegistry();
  const dispose = installProcessCleanup(registry);
  try {
    return await runBuildPlan(createBuildPlan(cases), {
      progress(message) {
        if (!options.json) {
          process.stderr.write(`${message}\n`);
        }
      },
      registry,
    });
  } finally {
    dispose();
    await registry.stopAll();
  }
}

if (isMainModule(import.meta.url)) {
  const results = await buildTodoBenchmark();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  }
}
