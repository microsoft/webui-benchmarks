// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { isMainModule } from "../servers/lib/cli.mjs";
import { parseOptions } from "./lib/options.mjs";
import { runBenchmark } from "./lib/orchestrator.mjs";
import { renderHumanReport, saveBaseline } from "./lib/report.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const report = await runBenchmark(options, {
    progress(message) {
      if (!options.json) {
        process.stderr.write(`${message}\n`);
      }
    },
  });
  let baselinePath = null;
  if (options.saveBaseline !== null) {
    baselinePath = saveBaseline(report, options.saveBaseline);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderHumanReport(report)}\n`);
    if (baselinePath !== null) {
      process.stdout.write(`Saved ${baselinePath}\n`);
    }
  }
  return report;
}

if (isMainModule(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const options = (() => {
      try {
        return parseOptions(process.argv.slice(2));
      } catch {
        return { json: process.argv.includes("--json") };
      }
    })();
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          message,
          schema: "webui.ssr-todo-benchmark-error/v1",
          status: "failed",
        }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`Todo benchmark failed: ${message}\n`);
    }
    process.exitCode = 1;
  }
}
