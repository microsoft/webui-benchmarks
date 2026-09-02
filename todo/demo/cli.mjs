// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import process from "node:process";
import {
  createDemoHandler,
  createRateLimiter,
  startDemoGateway,
} from "./gateway.mjs";
import { createDemoHost } from "./host.mjs";
import { createDemoRegistry } from "./registry.mjs";
import {
  ProcessRegistry,
  installProcessCleanup,
} from "../runner/lib/process-tree.mjs";
import { isMainModule } from "../servers/lib/cli.mjs";

const KNOWN_OPTIONS = Object.freeze(
  new Set(["--concurrency", "--host", "--port", "--rate-limit"]),
);

function parsePositiveInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function parseDemoArgs(argv, environment = process.env) {
  const options = {
    concurrency: parsePositiveInteger(
      "--concurrency",
      environment.WEBUI_DEMO_CONCURRENCY ?? "4",
    ),
    host: environment.WEBUI_DEMO_HOST ?? "0.0.0.0",
    port: parsePositiveInteger(
      "--port",
      environment.PORT ?? environment.WEBUI_DEMO_PORT ?? "8080",
    ),
    rateLimit: parsePositiveInteger(
      "--rate-limit",
      environment.WEBUI_DEMO_RATE_LIMIT ?? "0",
    ),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!KNOWN_OPTIONS.has(argument)) {
      throw new Error(`Unknown option '${argument}'`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${argument} requires a value`);
    }
    index += 1;
    if (argument === "--port") {
      options.port = parsePositiveInteger("--port", value);
    } else if (argument === "--host") {
      options.host = value;
    } else if (argument === "--concurrency") {
      options.concurrency = parsePositiveInteger("--concurrency", value);
    } else {
      options.rateLimit = parsePositiveInteger("--rate-limit", value);
    }
  }
  if (options.port > 65_535) {
    throw new RangeError("--port must be a valid TCP port");
  }
  return Object.freeze(options);
}

export async function runDemo({
  argv = process.argv.slice(2),
  progress = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const options = parseDemoArgs(argv);
  const products = createDemoRegistry();
  const registry = new ProcessRegistry();
  const removeCleanup = installProcessCleanup(registry);
  progress(`Preparing ${products.length} demo products`);
  const host = createDemoHost({
    concurrency: options.concurrency,
    progress,
    registry,
  });
  let gateway;
  try {
    gateway = await startDemoGateway({
      handler: createDemoHandler({
        ensureHosted: host.ensureHosted,
        hosted: host.hosted,
        isReady: host.isReady,
        launching: host.launching,
        products,
        rateLimiter: options.rateLimit === 0
          ? () => true
          : createRateLimiter({ limit: options.rateLimit }),
      }),
      host: options.host,
      port: options.port,
    });
  } catch (error) {
    await host.stopAll();
    removeCleanup();
    await registry.stopAll();
    throw error;
  }
  progress(`Demo gateway listening on http://${options.host}:${gateway.port}`);
  try {
    await host.prepareAll(products);
  } catch (error) {
    await gateway.close();
    await host.stopAll();
    removeCleanup();
    await registry.stopAll();
    throw error;
  }
  progress(`All ${products.length} demo products are ready and warm`);

  const shutdown = async () => {
    await gateway.close();
    await host.stopAll();
    removeCleanup();
    await registry.stopAll();
  };
  return Object.freeze({ gateway, host, products, shutdown });
}

if (isMainModule(import.meta.url)) {
  const demo = await runDemo();
  let stopping = false;
  const stop = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    demo.shutdown().then(
      () => process.exit(0),
      (error) => {
        process.stderr.write(`${error?.stack ?? error}\n`);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
