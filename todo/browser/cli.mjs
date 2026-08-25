// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import { isMainModule } from "../servers/lib/cli.mjs";
import { runBrowserBenchmark } from "./runner.mjs";

function nextValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseBrowserOptions(argv) {
  const options = {
    appFilters: [],
    build: false,
    headless: true,
    json: false,
    mode: "official",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--") {
      continue;
    } else if (option === "--apps" || option === "--app") {
      const value = nextValue(argv, index, option);
      options.appFilters.push(
        ...value.split(",").map((app) => app.trim()).filter(Boolean),
      );
      index += 1;
    } else if (option === "--build") {
      options.build = true;
    } else if (option === "--headed") {
      options.headless = false;
    } else if (option === "--json") {
      options.json = true;
    } else if (option === "--official") {
      options.mode = "official";
    } else if (option === "--output") {
      options.outputPath = nextValue(argv, index, option);
      index += 1;
    } else if (option === "--quick") {
      options.mode = "quick";
    } else if (option === "--rounds") {
      options.rounds = Number(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--seed") {
      options.seed = nextValue(argv, index, option);
      index += 1;
    } else if (option === "--viewport") {
      const value = nextValue(argv, index, option);
      const match = /^(\d+)x(\d+)$/u.exec(value);
      if (match === null) {
        throw new Error("--viewport must use WIDTHxHEIGHT");
      }
      options.viewport = {
        height: Number(match[2]),
        width: Number(match[1]),
      };
      index += 1;
    } else if (option === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown browser benchmark option '${option}'`);
    }
  }
  return options;
}

function help() {
  return [
    "Usage: node todo/browser/cli.mjs [options]",
    "",
    "  --official          Run exactly seven randomized rounds (default)",
    "  --quick             Run one smoke round",
    "  --apps LIST         Comma-separated app ids",
    "  --build             Build selected production server artifacts first",
    "  --rounds N          Official rounds (exactly 7)",
    "  --output PATH       Override the results output path",
    "  --viewport WxH      Chromium viewport (default 1440x900)",
    "  --seed VALUE        Deterministic randomization seed",
    "  --headed            Show Chromium",
    "  --json              Also print the JSON report to stdout",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseBrowserOptions(argv);
  if (options.help) {
    process.stdout.write(`${help()}\n`);
    return null;
  }
  const result = await runBrowserBenchmark({
    ...options,
    progress(message) {
      process.stderr.write(`${message}\n`);
    },
  });
  process.stderr.write(`browser outcomes: ${result.outputPath}\n`);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  await main();
}
