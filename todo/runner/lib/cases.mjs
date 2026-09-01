// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export const OFFICIAL_MATRIX_ID = "official-ssr-matrix";
export const HEADLINE_INPUT_POLICY = "request-timestamped-input";
export const NATURAL_PAYLOAD_POLICY = "natural";
export const OFFICIAL_CASE_COUNT = 15;

export const PRODUCT_KINDS = Object.freeze({
  framework: "framework-server",
  renderer: "product-renderer",
  webui: "webui-runtime",
});

// The response-mode dimension separates *what is measured* from *product
// identity*: every product id above is unique and stable across both suites,
// only the response contract changes.
//   - complete:    all data is ready; the server publishes exactly one
//                  completed HTML response (RPS/p95/CPU/bytes/memory ranking).
//   - progressive: the product's native progressive/streaming boundaries are
//                  preserved unchanged (time-to-boundary/UX ranking).
export const RESPONSE_MODES = Object.freeze({
  complete: "complete",
  progressive: "progressive",
});

// WebUI's resumable async data-boundary (StreamingSession) is a first-class
// capability in WebUI 0.0.28, but this suite does not yet implement the
// dedicated async shell/list boundary workload. The progressive suite honestly
// reports that implementation gap so consumers do not mistake "unchanged
// native streaming" for "new async data-boundary streaming". See README.md for
// the follow-up.
export const ASYNC_DATA_BOUNDARY_CAPABILITY = Object.freeze({
  canonicalWebuiVersion: "0.0.28",
  notes:
    "The progressive suite continues to measure each product's existing "
    + "native progressive/streaming boundaries unchanged. A dedicated "
    + "above-the-fold-shell / below-the-fold-async-list workload driven by "
    + "WebUI's resumable StreamingSession boundary API is intentionally not "
    + "implemented yet against canonical WebUI 0.0.28. This is disclosed "
    + "capability metadata, not an active measurement.",
  requiredCapability: "StreamingSession resumable async data-boundary API",
  status: "available-pending-benchmark-implementation",
});

// Grouping consumed by the separate, non-headline browser outcome tier when it
// picks one SSR source per application. The official SSR table itself is flat.
export const TIERS = Object.freeze({
  controlled: "product-renderer-transport",
  fullStack: "framework-production-server",
});

const NODE_HTTP_TRANSPORT = "node:http";
const WEBUI_NATIVE_RENDERER =
  "@microsoft/webui Protocol.streamResponse (request-materialized Node-API state)";

function freezeCase(value) {
  if (typeof value.renderer !== "string" || typeof value.transport !== "string") {
    throw new Error(`${value.id} must declare its renderer and transport`);
  }
  return Object.freeze({
    cacheRoute: "/cached",
    dynamicRoute: "/dynamic",
    headline: true,
    inputPolicy: HEADLINE_INPUT_POLICY,
    matrixId: OFFICIAL_MATRIX_ID,
    mode: "dynamic",
    payloadPolicy: NATURAL_PAYLOAD_POLICY,
    responseMode: RESPONSE_MODES.progressive,
    streaming: value.streaming ?? "buffered",
    workerCount: 1,
    ...value,
    buildIds: Object.freeze(value.buildIds ?? []),
    launcher: Object.freeze(value.launcher),
    tier: value.productKind === PRODUCT_KINDS.framework
      ? TIERS.fullStack
      : TIERS.controlled,
  });
}

// Per-product overrides applied only when building the `complete` suite. Each
// entry documents the *best correct* complete-response mechanism the product
// already ships (see the adjacent render()/renderStream() adapters and the
// Rust WebUIHandler::render vs render_streaming split) so the complete suite
// never silently reuses a progressive/native-streaming code path.
const COMPLETE_RENDERER_OVERRIDES = Object.freeze({
  astro: {
    renderer:
      "Astro production SSR + @astrojs/preact island (fully collected at "
      + "the framework's own Node http.Server response boundary before "
      + "the response completes)",
  },
  next: {
    renderer:
      "Next.js production App Router SSR (fully collected at the "
      + "framework's own Node http.Server response boundary before the "
      + "response completes)",
  },
  preact: { renderer: "preact-render-to-string renderToString" },
  react: { renderer: "react-dom/server renderToString" },
  "react-tanstack": {
    renderer:
      "react-dom/server renderToString + @tanstack/react-router renderRouterToString",
  },
  solid: { renderer: "solid-js/web renderToString" },
  vue: { renderer: "@vue/server-renderer renderToString" },
  "webui-bun-serve": {
    renderer:
      "@microsoft/webui Protocol.render (request-materialized Node-API state)",
  },
  "webui-deno-serve": {
    renderer:
      "@microsoft/webui Protocol.render (request-materialized Node-API state)",
  },
  "webui-fast-rust-actix": {
    renderer: "webui-handler render (Rust, FAST V3, single response)",
  },
  "webui-node-http": {
    renderer:
      "@microsoft/webui Protocol.render (request-materialized Node-API state)",
  },
  "webui-rust-actix": { renderer: "webui-handler render (Rust)" },
  "webui-shadowdom-rust-actix": {
    renderer: "webui-handler render (Rust, Shadow DOM)",
  },
});

// Frameworks whose production servers already always publish one buffered
// response (SvelteKit and Nuxt here) keep their progressive-suite labels
// unchanged in the complete suite too: there is no native streaming path to
// collect, so `complete` and `progressive` measure the identical mechanism.
const COMPLETE_STREAMING_UNCHANGED = Object.freeze(
  new Set(["nuxt", "sveltekit"]),
);

function applyResponseMode(benchmarkCase, responseMode) {
  if (responseMode === RESPONSE_MODES.progressive) {
    return benchmarkCase;
  }
  const rendererOverride = COMPLETE_RENDERER_OVERRIDES[benchmarkCase.id];
  return Object.freeze({
    ...benchmarkCase,
    ...(rendererOverride ?? {}),
    launcher: Object.freeze({
      ...benchmarkCase.launcher,
      responseMode,
    }),
    responseMode,
    streaming: COMPLETE_STREAMING_UNCHANGED.has(benchmarkCase.id)
      ? benchmarkCase.streaming
      : "buffered",
  });
}

function webuiRuntimeCase({ buildIds, entry, id, label, runtimeId, serverId, transport }) {
  return freezeCase({
    appId: "webui",
    buildIds,
    id,
    label,
    launcher: { entry, kind: "webui-runtime" },
    productKind: PRODUCT_KINDS.webui,
    renderer: WEBUI_NATIVE_RENDERER,
    runtimeId,
    serverId,
    streaming: "progressive-boundaries",
    transport,
  });
}

function frameworkCase({ appId, label, renderer, streaming, transport }) {
  return freezeCase({
    appId,
    buildIds: [`full-stack-${appId}`],
    id: appId,
    label,
    launcher: { appId, kind: "full-stack" },
    productKind: PRODUCT_KINDS.framework,
    renderer,
    runtimeId: "node",
    serverId: appId,
    streaming,
    transport,
  });
}

function rendererCase({ appId, buildIds = [], label, renderer }) {
  return freezeCase({
    appId,
    buildIds,
    id: appId,
    label,
    launcher: { appId, kind: "renderer" },
    productKind: PRODUCT_KINDS.renderer,
    renderer,
    runtimeId: "node",
    serverId: "node-http",
    streaming: "native",
    transport: NODE_HTTP_TRANSPORT,
  });
}

function officialCases() {
  return [
    freezeCase({
      appId: "webui",
      buildIds: ["webui", "native-addon", "state-pool", "rust-actix"],
      id: "webui-rust-actix",
      label: "WebUI / Light DOM / Rust / Actix",
      launcher: { kind: "rust-actix" },
      productKind: PRODUCT_KINDS.webui,
      renderer: "webui-handler StreamingResponse (Rust)",
      runtimeId: "rust",
      serverId: "actix",
      streaming: "progressive-boundaries",
      transport: "actix-web",
    }),
    freezeCase({
      appId: "webui",
      buildIds: [
        "webui-shadowdom",
        "state-pool",
        "rust-actix",
      ],
      id: "webui-shadowdom-rust-actix",
      label: "WebUI / Shadow DOM / Rust / Actix",
      launcher: {
        kind: "rust-actix",
        protocol: "todo/apps/webui-shadowdom/dist/protocol.bin",
      },
      productKind: PRODUCT_KINDS.webui,
      renderer: "webui-handler StreamingResponse (Rust, Shadow DOM)",
      runtimeId: "rust",
      serverId: "actix",
      streaming: "progressive-boundaries",
      transport: "actix-web",
    }),
    freezeCase({
      appId: "webui-fast",
      buildIds: [
        "webui-fast",
        "state-pool",
        "rust-actix",
      ],
      id: "webui-fast-rust-actix",
      label: "WebUI / FAST V3 / Rust / Actix",
      launcher: {
        kind: "rust-actix",
        plugin: "fast-v3",
        protocol: "todo/apps/webui-fast/dist/protocol.bin",
      },
      productKind: PRODUCT_KINDS.webui,
      renderer: "webui-handler chunked ResponseWriter (Rust, FAST V3)",
      runtimeId: "rust",
      serverId: "actix",
      streaming: "native-chunks",
      transport: "actix-web",
    }),
    webuiRuntimeCase({
      buildIds: ["webui", "native-addon"],
      entry: "bun.mjs",
      id: "webui-bun-serve",
      label: "WebUI / Bun.serve",
      runtimeId: "bun",
      serverId: "bun-serve",
      transport: "Bun.serve",
    }),
    webuiRuntimeCase({
      buildIds: ["webui", "native-addon"],
      entry: "deno.mjs",
      id: "webui-deno-serve",
      label: "WebUI / Deno.serve",
      runtimeId: "deno",
      serverId: "deno-serve",
      transport: "Deno.serve",
    }),
    webuiRuntimeCase({
      buildIds: ["webui", "native-addon"],
      entry: "node-http.mjs",
      id: "webui-node-http",
      label: "WebUI / Node node:http",
      runtimeId: "node",
      serverId: "node-http",
      transport: NODE_HTTP_TRANSPORT,
    }),
    frameworkCase({
      appId: "sveltekit",
      label: "SvelteKit",
      renderer: "SvelteKit production SSR (buffered synchronous route)",
      streaming: "buffered",
      transport: "@sveltejs/adapter-node",
    }),
    frameworkCase({
      appId: "nuxt",
      label: "Nuxt",
      renderer: "Nuxt production SSR (buffered synchronous route)",
      streaming: "buffered",
      transport: "nitro node-server",
    }),
    frameworkCase({
      appId: "next",
      label: "Next.js",
      renderer: "Next.js production App Router streaming SSR",
      streaming: "native",
      transport: "next start",
    }),
    frameworkCase({
      appId: "astro",
      label: "Astro + Preact",
      renderer: "Astro production streaming SSR + @astrojs/preact island",
      streaming: "native",
      transport: "@astrojs/node standalone",
    }),
    rendererCase({
      appId: "vue",
      buildIds: ["vue"],
      label: "Vue",
      renderer: "@vue/server-renderer renderToWebStream",
    }),
    rendererCase({
      appId: "preact",
      buildIds: ["preact"],
      label: "Preact",
      renderer: "preact-render-to-string renderToReadableStream",
    }),
    rendererCase({
      appId: "react",
      buildIds: ["react"],
      label: "React",
      renderer: "react-dom/server renderToReadableStream",
    }),
    rendererCase({
      appId: "react-tanstack",
      buildIds: ["react-tanstack"],
      label: "React + TanStack Router",
      renderer:
        "react-dom/server stream + @tanstack/react-router renderRouterToStream",
    }),
    rendererCase({
      appId: "solid",
      buildIds: ["solid"],
      label: "Solid",
      renderer: "solid-js/web renderToStream",
    }),
  ];
}

/**
 * Build the official 15-row matrix for one response-mode suite. Product
 * identity (case id, appId, productKind, transport, runtimeId, serverId)
 * never changes between suites: only the response contract (renderer label,
 * streaming label, and the launcher's `responseMode` hint consumed by
 * server.mjs) does. Omitting `responseMode` preserves the exact progressive
 * suite that shipped before this dimension existed.
 */
export function createCaseMatrix({
  responseMode = RESPONSE_MODES.progressive,
} = {}) {
  if (!Object.values(RESPONSE_MODES).includes(responseMode)) {
    throw new RangeError(`Unknown response mode '${responseMode}'`);
  }
  const matrix = Object.freeze(
    officialCases().map((benchmarkCase) =>
      applyResponseMode(benchmarkCase, responseMode)
    ),
  );
  assertCaseMatrix(matrix);
  return matrix;
}

export function assertCaseMatrix(matrix) {
  if (matrix.length !== OFFICIAL_CASE_COUNT) {
    throw new Error(
      `The official SSR matrix must contain exactly ${OFFICIAL_CASE_COUNT} rows, found ${matrix.length}`,
    );
  }
  const ids = new Set();
  const responseModes = new Set();
  for (const benchmarkCase of matrix) {
    if (ids.has(benchmarkCase.id)) {
      throw new Error(`Duplicate benchmark case '${benchmarkCase.id}'`);
    }
    ids.add(benchmarkCase.id);
    if (!benchmarkCase.headline) {
      throw new Error(`${benchmarkCase.id} is not part of the headline matrix`);
    }
    if (benchmarkCase.workerCount !== 1) {
      throw new Error(`${benchmarkCase.id} is not a one-worker headline case`);
    }
    if (benchmarkCase.mode !== "dynamic") {
      throw new Error(`${benchmarkCase.id} must render dynamic SSR every request`);
    }
    if (benchmarkCase.inputPolicy !== HEADLINE_INPUT_POLICY) {
      throw new Error(`${benchmarkCase.id} mixes a diagnostic into headline`);
    }
    if (benchmarkCase.payloadPolicy !== NATURAL_PAYLOAD_POLICY) {
      throw new Error(`${benchmarkCase.id} must publish natural response bytes`);
    }
    if (benchmarkCase.serverId === "fastify") {
      throw new Error(`${benchmarkCase.id} must not use the Fastify transport`);
    }
    if (!Object.values(RESPONSE_MODES).includes(benchmarkCase.responseMode)) {
      throw new Error(`${benchmarkCase.id} has an unknown response mode`);
    }
    responseModes.add(benchmarkCase.responseMode);
  }
  if (responseModes.size > 1) {
    throw new Error(
      "A benchmark matrix must not mix response modes: publish complete and "
      + "progressive results as separate reports",
    );
  }
  return matrix;
}

function wildcardMatch(value, pattern) {
  if (pattern === "*" || value === pattern) {
    return true;
  }
  const parts = pattern.split("*");
  let cursor = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.length === 0) {
      continue;
    }
    const found = value.indexOf(part, cursor);
    if (found === -1 || (index === 0 && !pattern.startsWith("*") && found !== 0)) {
      return false;
    }
    cursor = found + part.length;
  }
  return pattern.endsWith("*") || cursor === value.length;
}

function caseSelectors(benchmarkCase) {
  return [
    benchmarkCase.id,
    benchmarkCase.appId,
    benchmarkCase.productKind,
    benchmarkCase.runtimeId,
    benchmarkCase.serverId,
  ];
}

export function filterCases(matrix, filters) {
  if (filters.length === 0) {
    return [...matrix];
  }
  const aliases = {
    framework: PRODUCT_KINDS.framework,
    "full-stack": PRODUCT_KINDS.framework,
    renderer: PRODUCT_KINDS.renderer,
    runtime: PRODUCT_KINDS.webui,
  };
  const selected = matrix.filter((benchmarkCase) =>
    filters.some((filter) =>
      caseSelectors(benchmarkCase).some((selector) =>
        wildcardMatch(selector, aliases[filter] ?? filter)
      )
    )
  );
  if (selected.length === 0) {
    throw new Error(`No benchmark cases matched: ${filters.join(", ")}`);
  }
  return selected;
}
