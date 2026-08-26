// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const BASELINE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RUNTIME_MODES = new Set(["local", "official"]);

export const DEFAULT_PROTOCOL = Object.freeze({
  connections: 64,
  durationSeconds: 20,
  loadWorkers: 2,
  rounds: 1,
  saturationConnections: Object.freeze([64, 128]),
  saturationDurationSeconds: 4,
  warmupSeconds: 3,
});

export const QUICK_PROTOCOL = Object.freeze({
  connections: 10,
  durationSeconds: 1,
  loadWorkers: 0,
  rounds: 1,
  saturationConnections: Object.freeze([1, 10]),
  saturationDurationSeconds: 1,
  warmupSeconds: 1,
});

function positiveInteger(value, option, { allowZero = false } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new RangeError(`${option} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

function positiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${option} must be a positive number`);
  }
  return parsed;
}

function numberList(value, option) {
  const values = value.split(",").map((entry) =>
    positiveInteger(entry.trim(), option)
  );
  return Object.freeze([...new Set(values)]);
}

function optionParts(argument) {
  const equals = argument.indexOf("=");
  return equals === -1
    ? { name: argument, value: undefined }
    : {
        name: argument.slice(0, equals),
        value: argument.slice(equals + 1),
      };
}

function requiredValue(argv, index, name, inlineValue) {
  if (inlineValue !== undefined) {
    if (inlineValue.length === 0) {
      throw new Error(`${name} requires a value`);
    }
    return { index, value: inlineValue };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return { index: index + 1, value };
}

export function parseOptions(argv, environment = process.env) {
  let quick = false;
  let json = false;
  let build;
  let saveBaseline = environment.WEBUI_BENCH_SAVE?.trim() || null;
  let runtimeMode =
    environment.WEBUI_BENCH_RUNTIME_MODE?.trim() || "local";
  let serverCpu = environment.WEBUI_BENCH_SERVER_CPU === undefined
    ? null
    : positiveInteger(
        environment.WEBUI_BENCH_SERVER_CPU,
        "WEBUI_BENCH_SERVER_CPU",
        { allowZero: true },
      );
  const caseFilters = [];
  const overrides = {};
  let scalingCores = Object.freeze([1]);

  for (let index = 0; index < argv.length; index += 1) {
    const { name, value: inlineValue } = optionParts(argv[index]);
    if (name === "--") {
      continue;
    } else if (name === "--quick") {
      quick = true;
    } else if (name === "--json") {
      json = true;
    } else if (name === "--build") {
      build = true;
    } else if (name === "--skip-build") {
      build = false;
    } else if (
      name === "--save-baseline"
      || name === "--runtime-mode"
      || name === "--case"
      || name === "--connections"
      || name === "--duration"
      || name === "--warmup"
      || name === "--rounds"
      || name === "--load-workers"
      || name === "--sweep"
      || name === "--sweep-duration"
      || name === "--scale-cores"
      || name === "--scaling"
      || name === "--server-cpu"
    ) {
      const parsed = requiredValue(argv, index, name, inlineValue);
      index = parsed.index;
      if (name === "--save-baseline") {
        saveBaseline = parsed.value;
      } else if (name === "--runtime-mode") {
        runtimeMode = parsed.value;
      } else if (name === "--case") {
        caseFilters.push(
          ...parsed.value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        );
      } else if (name === "--connections") {
        overrides.connections = positiveInteger(parsed.value, name);
      } else if (name === "--duration") {
        overrides.durationSeconds = positiveNumber(parsed.value, name);
      } else if (name === "--warmup") {
        overrides.warmupSeconds = positiveNumber(parsed.value, name);
      } else if (name === "--rounds") {
        overrides.rounds = positiveInteger(parsed.value, name);
      } else if (name === "--load-workers") {
        overrides.loadWorkers = positiveInteger(parsed.value, name, {
          allowZero: true,
        });
      } else if (name === "--sweep") {
        overrides.saturationConnections = numberList(parsed.value, name);
      } else if (name === "--sweep-duration") {
        overrides.saturationDurationSeconds = positiveNumber(
          parsed.value,
          name,
        );
      } else if (name === "--server-cpu") {
        serverCpu = positiveInteger(parsed.value, name, { allowZero: true });
      } else {
        scalingCores = numberList(parsed.value, name);
      }
    } else {
      throw new Error(`Unknown option: ${name}`);
    }
  }

  if (!RUNTIME_MODES.has(runtimeMode)) {
    throw new Error("--runtime-mode must be 'local' or 'official'");
  }
  if (saveBaseline !== null && !BASELINE_PATTERN.test(saveBaseline)) {
    throw new Error("--save-baseline has an invalid baseline name");
  }
  if (runtimeMode === "official" && build === false) {
    throw new Error("--skip-build is not permitted in official runtime mode");
  }
  if (runtimeMode === "official" && serverCpu === null) {
    serverCpu = 0;
  }
  const base = quick ? QUICK_PROTOCOL : DEFAULT_PROTOCOL;
  const protocol = Object.freeze({ ...base, ...overrides });
  return Object.freeze({
    build: build ?? (!quick || runtimeMode === "official"),
    caseFilters: Object.freeze(caseFilters),
    json,
    protocol,
    quick,
    runtimeMode,
    saveBaseline,
    scalingCores,
    serverCpu,
  });
}
