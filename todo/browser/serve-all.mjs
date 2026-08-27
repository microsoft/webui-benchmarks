// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createBrowserCases } from "./apps.mjs";
import { buildControlledClients } from "./build-clients.mjs";
import { withCaseResources } from "./runner.mjs";
import {
  ProcessRegistry,
  installProcessCleanup,
} from "../runner/lib/process-tree.mjs";
import { isMainModule } from "../servers/lib/cli.mjs";

export async function serveAllBrowserApps({
  progress = (message) => console.log(message),
} = {}) {
  const cases = createBrowserCases();
  const clients = await buildControlledClients(cases);
  if (clients.failures.size > 0) {
    throw new AggregateError(
      [...clients.failures].map(
        ([appId, reason]) => new Error(`${appId}: ${reason}`),
      ),
      "One or more browser clients failed to build",
    );
  }

  const registry = new ProcessRegistry();
  const removeProcessCleanup = installProcessCleanup(registry);
  let releaseServers;
  const holdServers = new Promise((resolve) => {
    releaseServers = resolve;
  });
  const keepAlive = setInterval(() => {}, 60_000);
  const ready = [];

  progress("Starting all production browser products...");
  progress(
    "Self-signed HTTPS is expected. Press Ctrl+C to stop every server.\n",
  );

  const launches = cases.map((browserCase) => {
    let markReady;
    ready.push(new Promise((resolve) => {
      markReady = resolve;
    }));
    return withCaseResources({
      browserCase,
      clientBundle: clients.bundles.get(browserCase.appId),
      operation: async ({ url }) => {
        progress(
          `${browserCase.label.padEnd(42)} ${url}/dynamic`,
        );
        markReady();
        await holdServers;
      },
      registry,
      serverRenderer: clients.serverRenderers.get(browserCase.appId),
    });
  });
  const firstFailure = new Promise((_, reject) => {
    for (const launch of launches) {
      launch.catch(reject);
    }
  });

  try {
    await Promise.race([Promise.all(ready), firstFailure]);
    await firstFailure;
  } finally {
    clearInterval(keepAlive);
    releaseServers();
    await Promise.allSettled(launches);
    removeProcessCleanup();
    await registry.stopAll();
  }
}

if (isMainModule(import.meta.url)) {
  await serveAllBrowserApps();
}
