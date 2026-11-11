// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  createCaseMatrix,
  filterCases,
  TIERS,
} from "../runner/lib/cases.mjs";

export const BROWSER_REPORT_SCHEMA = "webui.ssr-todo-browser-outcomes/v2";
export const BROWSER_TIER = "browser-secondary";
export const PRIMARY_ROUTE = "dynamic";
export const OFFICIAL_MINIMUM_ROUNDS = 10;
export const QUICK_ROUNDS = 1;
export const ROUTE_JOURNEY = Object.freeze([
  "/dynamic",
  "/activity",
  "/settings",
  "/dynamic",
]);

const PRODUCT_ORDER = Object.freeze(
  createCaseMatrix().map(({ id }) => id),
);
const HYDRATION_CLIENT_MODES = new Set([
  "framework-hydrate",
  "framework-island-hydrate",
  "hydrate",
  "interaction-hydrate",
]);

const CLIENT_METADATA = Object.freeze({
  webui: Object.freeze({
    clientMode: "interaction-hydrate",
    directRustBrowserServer: true,
    hydration: Object.freeze({
      framework:
        "@microsoft/webui-framework interaction-triggered application hydration",
      status: "deferred",
    }),
    initialStateSource: "ssr-document",
    label: "WebUI",
    lazyHydration: Object.freeze({
      scope: "app-shell and todo-item",
      status: "supported",
      strategy:
        'w-hydrate="interaction" root; w-render="lazy" w-reserve-block-size="18rem" rows',
    }),
    readinessDefinition:
      "The SSR shell has painted, interaction hydration and route intent preloading are installed, and two animation frames have completed.",
    router: "@microsoft/webui-delivery",
  }),
  "webui-fast": Object.freeze({
    clientMode: "hydrate",
    directRustBrowserServer: true,
    hydration: Object.freeze({
      framework: "@microsoft/fast-element 3 declarative hydration",
      status: "supported",
    }),
    initialStateSource: "ssr-document",
    label: "WebUI + FAST V3",
    lazyHydration: Object.freeze({
      reason: "The FAST V3 comparison hydrates the complete component tree eagerly.",
      status: "unavailable",
    }),
    readinessDefinition:
      "FAST has hydrated the declarative component tree and two animation frames have completed.",
    router: "@microsoft/webui-delivery",
  }),
  react: Object.freeze({
    clientMode: "hydrate",
    hydration: Object.freeze({
      framework: "react-dom/client hydrateRoot",
      status: "supported",
    }),
    label: "React",
    lazyHydration: Object.freeze({
      reason: "React has no built-in viewport hydration strategy.",
      status: "unavailable",
    }),
    readinessDefinition:
      "hydrateRoot has attached to the controlled SSR root and two animation frames have completed.",
    router: "react-router",
  }),
  "react-tanstack": Object.freeze({
    clientMode: "hydrate",
    hydration: Object.freeze({
      framework: "React hydrateRoot + @tanstack/react-router",
      status: "supported",
    }),
    label: "React + TanStack Router",
    initialStateSource: "ssr-document",
    lazyHydration: Object.freeze({
      reason: "React has no built-in viewport hydration strategy.",
      status: "unavailable",
    }),
    readinessDefinition:
      "TanStack Router has loaded the current route, hydrateRoot has attached, and two animation frames have completed.",
    router: "@tanstack/react-router",
  }),
  vue: Object.freeze({
    clientMode: "hydrate",
    hydration: Object.freeze({
      framework: "Vue createSSRApp.mount",
      status: "supported",
    }),
    label: "Vue",
    lazyHydration: Object.freeze({
      scope: "todo-item",
      status: "supported",
      strategy: "hydrateOnVisible",
    }),
    readinessDefinition:
      "Vue createSSRApp has mounted on the controlled SSR root and two animation frames have completed.",
    router: "vue-router",
  }),
  solid: Object.freeze({
    browserTierSsr: Object.freeze({
      artifact: "headline",
      generate: "ssr",
      hydratable: true,
    }),
    clientMode: "hydrate",
    hydration: Object.freeze({
      framework: "solid-js/web hydrate",
      status: "supported",
    }),
    label: "Solid",
    lazyHydration: Object.freeze({
      reason: "Solid lazy() is code splitting, not viewport hydration.",
      status: "unavailable",
    }),
    readinessDefinition:
      "Solid hydrate has attached to the authored hydratable SSR root and two animation frames have completed.",
    router: "@solidjs/router",
  }),
  lit: Object.freeze({
    clientMode: "hydrate",
    hydration: Object.freeze({
      framework:
        "@lit-labs/ssr-client lit-element hydrate support (declarative shadow DOM)",
      status: "supported",
    }),
    label: "Lit",
    lazyHydration: Object.freeze({
      reason:
        "Lit defers hydration per element with defer-hydration, but ships no "
        + "viewport strategy that drives it.",
      status: "unavailable",
    }),
    readinessDefinition:
      "Lit has hydrated the declarative shadow roots of the server-rendered "
      + "component tree and two animation frames have completed.",
    router: "@lit-labs/router",
  }),
  preact: Object.freeze({
    clientMode: "hydrate",
    hydration: Object.freeze({
      framework: "preact hydrate",
      status: "supported",
    }),
    label: "Preact",
    lazyHydration: Object.freeze({
      reason: "Preact has no built-in viewport hydration strategy.",
      status: "unavailable",
    }),
    readinessDefinition:
      "Preact hydrate has attached to the controlled SSR root and two animation frames have completed.",
    router: "preact-iso",
  }),
  next: Object.freeze({
    clientMode: "framework-hydrate",
    hydration: Object.freeze({
      framework: "Next.js App Router React hydration",
      status: "supported",
    }),
    label: "Next",
    lazyHydration: Object.freeze({
      reason: "Next dynamic imports do not defer hydration by viewport.",
      status: "unavailable",
    }),
    readinessDefinition:
      "The production load event, the complete 100-item semantic DOM, and two animation frames have completed.",
    router: "Next.js App Router",
  }),
  nuxt: Object.freeze({
    clientMode: "framework-hydrate",
    hydration: Object.freeze({
      framework: "Nuxt Vue hydration",
      status: "supported",
    }),
    label: "Nuxt",
    lazyHydration: Object.freeze({
      scope: "todo-item",
      status: "supported",
      strategy: "hydrate-on-visible",
    }),
    readinessDefinition:
      "The production load event, the complete 100-item semantic DOM, and two animation frames have completed.",
    router: "Nuxt pages router",
  }),
  sveltekit: Object.freeze({
    clientMode: "framework-hydrate",
    hydration: Object.freeze({
      framework: "SvelteKit hydration",
      status: "supported",
    }),
    label: "SvelteKit",
    lazyHydration: Object.freeze({
      reason: "SvelteKit has no built-in component viewport hydration strategy.",
      status: "unavailable",
    }),
    readinessDefinition:
      "The production load event, the complete 100-item semantic DOM, and two animation frames have completed.",
    router: "SvelteKit client router",
  }),
  astro: Object.freeze({
    clientMode: "framework-island-hydrate",
    hydration: Object.freeze({
      framework: "@astrojs/preact client:visible",
      status: "supported",
    }),
    label: "Astro + Preact",
    lazyHydration: Object.freeze({
      scope: "todo-app island",
      status: "supported",
      strategy: "client:visible",
    }),
    readinessDefinition:
      "The visible @astrojs/preact island, complete semantic DOM, and two animation frames have hydrated.",
    router: "Astro ClientRouter",
  }),
});

function freezeBrowserCase(sourceCase) {
  const { appId } = sourceCase;
  const client = CLIENT_METADATA[appId];
  if (client === undefined) {
    throw new Error(`Missing browser benchmark definition for '${appId}'`);
  }
  if (
    client.hydration.status === "unsupported"
    || typeof client.hydration.framework !== "string"
    || client.hydration.framework.length === 0
    || !HYDRATION_CLIENT_MODES.has(client.clientMode)
  ) {
    throw new Error(
      `Browser benchmark '${appId}' must use a real framework hydration path`,
    );
  }
  return Object.freeze({
    appId,
    browserTierSsr: client.browserTierSsr ?? null,
    browserOutcome: client.browserOutcome
      ?? Object.freeze({ status: "supported" }),
    clientMode: client.clientMode,
    controlled: sourceCase.tier === TIERS.controlled,
    directBrowserServer:
      client.directRustBrowserServer === true
      && sourceCase.runtimeId === "rust",
    headline: false,
    hydration: client.hydration,
    id: `browser:${sourceCase.id}`,
    initialStateSource: client.initialStateSource
      ?? (sourceCase.tier === TIERS.controlled
        ? "browser-wrapper"
        : "framework-server"),
    label: sourceCase.label,
    lazyHydration: client.lazyHydration,
    primaryRoute: PRIMARY_ROUTE,
    productId: sourceCase.id,
    readinessDefinition: client.readinessDefinition,
    routing: Object.freeze({
      clientNavigation: "supported",
      journey: ROUTE_JOURNEY,
      router: client.router,
    }),
    sourceCase,
    sourceSsrCaseId: sourceCase.id,
    tier: BROWSER_TIER,
  });
}

export function createBrowserCases(appFilters = []) {
  return Object.freeze(
    filterCases(createCaseMatrix(), appFilters).map(freezeBrowserCase),
  );
}

export function frameworkVersionsForApp(appId, versions) {
  if (Object.hasOwn(versions.fullStack, appId)) {
    return versions.fullStack[appId];
  }
  const names = {
    preact: ["preact", "preact-iso", "preact-render-to-string"],
    react: ["react", "react-dom", "react-router"],
    "react-tanstack": [
      "react",
      "react-dom",
      "@tanstack/react-router",
    ],
    lit: ["lit", "@lit-labs/ssr", "@lit-labs/ssr-client", "@lit-labs/router"],
    solid: ["solid-js", "@solidjs/router"],
    vue: ["vue", "vue-router", "@vue/server-renderer"],
  }[appId];
  if (appId === "webui") {
    return Object.freeze({
      "@microsoft/webui": versions.webui,
      "@microsoft/webui-delivery":
        versions.controlled["@microsoft/webui-delivery"],
    });
  }
  if (appId === "webui-fast") {
    return Object.freeze({
      "@microsoft/fast-element":
        versions.controlled["@microsoft/fast-element"],
      "@microsoft/webui": versions.webui,
      "@microsoft/webui-delivery":
        versions.controlled["@microsoft/webui-delivery"],
    });
  }
  return Object.freeze(
    Object.fromEntries(names.map((name) => [name, versions.controlled[name]])),
  );
}

export {
  CLIENT_METADATA,
  PRODUCT_ORDER,
  PRODUCT_ORDER as APP_ORDER,
};
