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
export const OFFICIAL_MINIMUM_ROUNDS = 7;
export const QUICK_ROUNDS = 1;

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
    clientMode: "hydrate",
    directRustBrowserServer: true,
    hydration: Object.freeze({
      framework: "@microsoft/webui-framework eager root hydration",
      status: "supported",
    }),
    initialStateSource: "ssr-document",
    label: "WebUI",
    lazyHydration: Object.freeze({
      scope: "todo-item",
      status: "supported",
      strategy: 'w-render="lazy" w-reserve-block-size="18rem"',
    }),
    readinessDefinition:
      "The interactive root has hydrated, viewport-deferred rows are registered, and two animation frames have completed.",
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
    preact: ["preact", "preact-render-to-string"],
    react: ["react", "react-dom"],
    solid: ["solid-js"],
    vue: ["vue", "@vue/server-renderer"],
  }[appId];
  if (appId === "webui") {
    return Object.freeze({ "@microsoft/webui": versions.webui });
  }
  if (appId === "webui-fast") {
    return Object.freeze({
      "@microsoft/fast-element":
        versions.controlled["@microsoft/fast-element"],
      "@microsoft/webui": versions.webui,
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
