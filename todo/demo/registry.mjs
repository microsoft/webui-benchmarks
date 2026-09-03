// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  RESPONSE_MODES,
  createCaseMatrix,
} from "../runner/lib/cases.mjs";

export const DEMO_REGISTRY_SCHEMA = "webui.ssr-todo-demo-registry/v1";

/**
 * The demo hosts one server per todo application, not one server per official
 * benchmark row. The official matrix intentionally measures the same WebUI
 * Light DOM application on four runtime hosts (Actix, Bun, Deno, Node); the
 * demo keeps only its canonical Rust/Actix host so every hosted product is a
 * distinct application rather than a repeated one.
 */
const ALTERNATE_RUNTIME_HOSTS = Object.freeze(
  new Set(["webui-bun-serve", "webui-deno-serve", "webui-node-http"]),
);

/**
 * Presentation metadata for the gallery. `application` is the on-disk todo
 * application under `todo/apps/`; `family` groups the cards.
 */
const PRESENTATION = Object.freeze({
  astro: Object.freeze({
    application: "astro",
    family: "Islands",
    summary:
      "Astro production SSR with a hydrated @astrojs/preact island and the Astro ClientRouter.",
  }),
  lit: Object.freeze({
    application: "lit",
    family: "Web Components",
    summary:
      "@lit-labs/ssr streaming declarative shadow DOM with @lit-labs/router on "
      + "the shared node:http transport.",
  }),
  next: Object.freeze({
    application: "next",
    family: "React",
    summary: "Next.js production App Router SSR served by next start.",
  }),
  nuxt: Object.freeze({
    application: "nuxt",
    family: "Vue",
    summary: "Nuxt production SSR served by the nitro node-server.",
  }),
  preact: Object.freeze({
    application: "preact",
    family: "React",
    summary:
      "preact-render-to-string with preact-iso routing on the shared node:http transport.",
  }),
  react: Object.freeze({
    application: "react",
    family: "React",
    summary:
      "react-dom/server with React Router on the shared node:http transport.",
  }),
  "react-tanstack": Object.freeze({
    application: "react-tanstack",
    family: "React",
    summary:
      "react-dom/server with the TanStack Router SSR pipeline on the shared node:http transport.",
  }),
  solid: Object.freeze({
    application: "solid",
    family: "Signals",
    summary: "solid-js/web with Solid Router on the shared node:http transport.",
  }),
  sveltekit: Object.freeze({
    application: "sveltekit",
    family: "Compiled",
    summary: "SvelteKit production SSR served by @sveltejs/adapter-node.",
  }),
  vue: Object.freeze({
    application: "vue",
    family: "Vue",
    summary:
      "@vue/server-renderer with Vue Router on the shared node:http transport.",
  }),
  "webui-fast-rust-actix": Object.freeze({
    application: "webui-fast",
    family: "WebUI",
    summary:
      "WebUI compiled protocol with @microsoft/fast-element 3 declarative hydration, served by Rust/Actix.",
  }),
  "webui-rust-actix": Object.freeze({
    application: "webui-lightdom",
    family: "WebUI",
    summary:
      "WebUI compiled protocol rendered as Light DOM by the Rust webui-handler on Actix.",
  }),
  "webui-shadowdom-rust-actix": Object.freeze({
    application: "webui-shadowdom",
    family: "WebUI",
    summary:
      "WebUI compiled protocol rendered as Shadow DOM by the Rust webui-handler on Actix.",
  }),
});

const RESPONSE_MODE_PRESENTATION = Object.freeze({
  [RESPONSE_MODES.complete]: Object.freeze({
    label: "No streaming",
    summary:
      "The product publishes exactly one fully collected HTML response.",
  }),
  [RESPONSE_MODES.progressive]: Object.freeze({
    label: "Streaming",
    summary: "The product keeps its own native progressive/streaming boundaries.",
  }),
});

export const DEMO_RESPONSE_MODES = Object.freeze([
  RESPONSE_MODES.progressive,
  RESPONSE_MODES.complete,
]);

export const DEMO_APPLICATION_COUNT = 13;
export const DEMO_PRODUCT_COUNT =
  DEMO_APPLICATION_COUNT * DEMO_RESPONSE_MODES.length;

export function demoProductId(caseId, responseMode) {
  return `${caseId}--${responseMode}`;
}

function demoProduct(benchmarkCase) {
  const presentation = PRESENTATION[benchmarkCase.id];
  if (presentation === undefined) {
    throw new Error(`Missing demo presentation for '${benchmarkCase.id}'`);
  }
  const mode = RESPONSE_MODE_PRESENTATION[benchmarkCase.responseMode];
  const id = demoProductId(benchmarkCase.id, benchmarkCase.responseMode);
  return Object.freeze({
    appId: benchmarkCase.appId,
    application: presentation.application,
    benchmarkPath: `/benchmark/${id}`,
    launchPath: `/app/${id}`,
    caseId: benchmarkCase.id,
    family: presentation.family,
    id,
    label: benchmarkCase.label,
    renderer: benchmarkCase.renderer,
    responseMode: benchmarkCase.responseMode,
    responseModeLabel: mode.label,
    responseModeSummary: mode.summary,
    sourceCase: benchmarkCase,
    streaming: benchmarkCase.streaming,
    summary: presentation.summary,
    transport: benchmarkCase.transport,
  });
}

/**
 * Build the demo registry: every hosted todo application in both response-mode
 * variants, ordered so the two variants of one application stay adjacent.
 */
export function createDemoRegistry() {
  const suites = DEMO_RESPONSE_MODES.map((responseMode) =>
    createCaseMatrix({ responseMode }).filter(
      (benchmarkCase) => !ALTERNATE_RUNTIME_HOSTS.has(benchmarkCase.id),
    )
  );
  const [progressive] = suites;
  const products = progressive.flatMap((_, index) =>
    suites.map((suite) => demoProduct(suite[index]))
  );
  return assertDemoRegistry(Object.freeze(products));
}

export function assertDemoRegistry(products) {
  if (products.length !== DEMO_PRODUCT_COUNT) {
    throw new Error(
      `The demo must host exactly ${DEMO_PRODUCT_COUNT} products, found ${products.length}`,
    );
  }
  const ids = new Set();
  const applications = new Set();
  for (const product of products) {
    if (ids.has(product.id)) {
      throw new Error(`Duplicate demo product '${product.id}'`);
    }
    ids.add(product.id);
    applications.add(product.application);
    if (!DEMO_RESPONSE_MODES.includes(product.responseMode)) {
      throw new Error(`${product.id} has an unknown response mode`);
    }
    if (!/^\/app\/[\w.-]+$/u.test(product.launchPath)) {
      throw new Error(`${product.id} has an unsafe base path`);
    }
    if (!/^\/benchmark\/[\w.-]+$/u.test(product.benchmarkPath)) {
      throw new Error(`${product.id} has an unsafe benchmark path`);
    }
  }
  if (applications.size !== DEMO_APPLICATION_COUNT) {
    throw new Error(
      `The demo must host exactly ${DEMO_APPLICATION_COUNT} applications, found ${applications.size}`,
    );
  }
  return products;
}

/**
 * Group the flat registry by application so the gallery can render one card
 * per application with both response-mode variants inside it.
 */
export function groupDemoProducts(products) {
  const groups = new Map();
  for (const product of products) {
    const group = groups.get(product.application) ?? {
      application: product.application,
      family: product.family,
      label: product.label,
      summary: product.summary,
      variants: [],
    };
    group.variants.push(product);
    groups.set(product.application, group);
  }
  return Object.freeze(
    [...groups.values()].map((group) =>
      Object.freeze({ ...group, variants: Object.freeze(group.variants) })
    ),
  );
}
