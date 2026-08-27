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

// Grouping consumed by the separate, non-headline browser outcome tier when it
// picks one SSR source per application. The official SSR table itself is flat.
export const TIERS = Object.freeze({
  controlled: "product-renderer-transport",
  fullStack: "framework-production-server",
});

const NODE_HTTP_TRANSPORT = "node:http";
const WEBUI_NATIVE_RENDERER =
  "@microsoft/webui Protocol.render (request-materialized Node-API state)";

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
    workerCount: 1,
    ...value,
    buildIds: Object.freeze(value.buildIds ?? []),
    launcher: Object.freeze(value.launcher),
    tier: value.productKind === PRODUCT_KINDS.framework
      ? TIERS.fullStack
      : TIERS.controlled,
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
    transport,
  });
}

function frameworkCase({ appId, label, renderer, transport }) {
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
    transport: NODE_HTTP_TRANSPORT,
  });
}

function officialCases() {
  return [
    freezeCase({
      appId: "webui",
      buildIds: ["webui", "native-addon", "state-pool", "rust-actix"],
      id: "webui-rust-actix",
      label: "WebUI / Rust / Actix",
      launcher: { kind: "rust-actix" },
      productKind: PRODUCT_KINDS.webui,
      renderer: "webui-handler WebUIHandler (Rust)",
      runtimeId: "rust",
      serverId: "actix",
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
      renderer: "webui-handler WebUIHandler (Rust, Shadow DOM)",
      runtimeId: "rust",
      serverId: "actix",
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
      renderer: "webui-handler WebUIHandler (Rust, FAST V3)",
      runtimeId: "rust",
      serverId: "actix",
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
      renderer: "SvelteKit production SSR (@sveltejs/kit)",
      transport: "@sveltejs/adapter-node",
    }),
    frameworkCase({
      appId: "nuxt",
      label: "Nuxt",
      renderer: "Nuxt production SSR (vue-bundle-renderer)",
      transport: "nitro node-server",
    }),
    frameworkCase({
      appId: "next",
      label: "Next.js",
      renderer: "Next.js production App Router SSR",
      transport: "next start",
    }),
    frameworkCase({
      appId: "astro",
      label: "Astro + Preact",
      renderer: "Astro production SSR + @astrojs/preact island",
      transport: "@astrojs/node standalone",
    }),
    rendererCase({
      appId: "vue",
      buildIds: ["vue"],
      label: "Vue",
      renderer: "@vue/server-renderer renderToString",
    }),
    rendererCase({
      appId: "preact",
      buildIds: ["preact"],
      label: "Preact",
      renderer: "preact-render-to-string renderToString",
    }),
    rendererCase({
      appId: "react",
      buildIds: ["react"],
      label: "React",
      renderer: "react-dom/server renderToString",
    }),
    rendererCase({
      appId: "react-tanstack",
      buildIds: ["react-tanstack"],
      label: "React + TanStack Router",
      renderer:
        "react-dom/server renderToString + @tanstack/react-router",
    }),
    rendererCase({
      appId: "solid",
      buildIds: ["solid"],
      label: "Solid",
      renderer: "solid-js/web renderToString",
    }),
  ];
}

export function createCaseMatrix() {
  const matrix = Object.freeze(officialCases());
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
