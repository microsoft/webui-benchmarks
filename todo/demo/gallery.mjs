// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ENTRY_ROUTE } from "./routing.mjs";
import { groupDemoProducts } from "./registry.mjs";

const ESCAPES = Object.freeze({
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
});

export function escapeHtml(value) {
  return String(value).replaceAll(/["&'<>]/gu, (character) => ESCAPES[character]);
}

const STYLES = `
:root {
  color-scheme: dark;
  --demo-surface: #14161c;
  --demo-surface-raised: #1c1f27;
  --demo-border: #2b303c;
  --demo-text: #e8eaf0;
  --demo-muted: #a2a9ba;
  --demo-accent: #4da3ff;
}
* { box-sizing: border-box; }
body {
  background: #0d0f14;
  color: var(--demo-text);
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  margin: 0;
  padding: 2.5rem 1.5rem 4rem;
}
main { margin: 0 auto; max-width: 78rem; }
h1 { font-size: 1.9rem; margin: 0 0 0.5rem; }
.demo-lede { color: var(--demo-muted); margin: 0 0 2rem; max-width: 56rem; }
.demo-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
}
.demo-card {
  background: var(--demo-surface);
  border: 1px solid var(--demo-border);
  border-radius: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.15rem;
}
.demo-card h2 { font-size: 1.1rem; margin: 0; }
.demo-family {
  color: var(--demo-accent);
  font-size: 0.72rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.demo-summary { color: var(--demo-muted); font-size: 0.87rem; margin: 0; }
.demo-variants { display: grid; gap: 0.5rem; margin: 0; padding: 0; }
.demo-variant {
  align-items: center;
  background: var(--demo-surface-raised);
  border: 1px solid var(--demo-border);
  border-radius: 0.5rem;
  color: inherit;
  display: flex;
  gap: 0.65rem;
  justify-content: space-between;
  padding: 0.6rem 0.8rem;
  text-decoration: none;
}
.demo-variant:hover, .demo-variant:focus-visible {
  border-color: var(--demo-accent);
  outline: none;
}
.demo-variant-name { font-weight: 600; }
.demo-variant-detail { color: var(--demo-muted); font-size: 0.78rem; }
footer { color: var(--demo-muted); font-size: 0.82rem; margin-top: 2.5rem; }
a { color: var(--demo-accent); }
`;

function variantMarkup(product) {
  return [
    `<a class="demo-variant" href="${escapeHtml(product.launchPath)}${ENTRY_ROUTE}">`,
    "<span>",
    `<span class="demo-variant-name">${escapeHtml(product.responseModeLabel)}</span><br>`,
    `<span class="demo-variant-detail">${escapeHtml(product.streaming)}</span>`,
    "</span>",
    `<span class="demo-variant-detail">${escapeHtml(product.transport)}</span>`,
    "</a>",
  ].join("");
}

function cardMarkup(group) {
  return [
    '<article class="demo-card">',
    `<span class="demo-family">${escapeHtml(group.family)}</span>`,
    `<h2>${escapeHtml(group.label)}</h2>`,
    `<p class="demo-summary">${escapeHtml(group.summary)}</p>`,
    '<div class="demo-variants">',
    group.variants.map(variantMarkup).join(""),
    "</div>",
    "</article>",
  ].join("");
}

export function renderGallery(products) {
  const groups = groupDemoProducts(products);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>WebUI SSR todo benchmark demo</title>",
    `<style>${STYLES}</style>`,
    "</head>",
    "<body>",
    "<main>",
    "<h1>WebUI SSR todo benchmark demo</h1>",
    `<p class="demo-lede">The same routed todo workspace, implemented ${
      groups.length
    } times and available as ${products.length} products: every application runs in both response-mode variants and starts on first open. `,
    "<strong>Streaming</strong> keeps each product's native progressive boundaries; ",
    "<strong>No streaming</strong> publishes exactly one fully collected HTML response.</p>",
    '<p class="demo-lede">Opening a product hands it the root of this origin so it runs '
      + "exactly as it does in the benchmark, with its own routes and asset URLs. One "
      + "product is active per browser session: use the back button to return here and "
      + "pick another.</p>",
    '<div class="demo-grid">',
    groups.map(cardMarkup).join(""),
    "</div>",
    "<footer>",
    `<a href="/_demo/apps.json">Registry JSON</a> · <a href="/healthz">Health</a> · <a href="/readyz">Readiness</a>`,
    "</footer>",
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

export function renderNotFound() {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Not found · WebUI SSR todo benchmark demo</title>",
    `<style>${STYLES}</style>`,
    "</head>",
    "<body><main>",
    "<h1>Not found</h1>",
    '<p class="demo-lede">Every product is opened from <code>/app/{product}</code>, '
      + "which hands that product the root of this origin for the rest of the session. "
      + "Pick one from the gallery to start.</p>",
    '<p><a href="/">Back to the gallery</a></p>',
    "</main></body>",
    "</html>",
  ].join("");
}

export function registryDocument(products) {
  return Object.freeze({
    applications: groupDemoProducts(products).length,
    products: products.map((product) =>
      Object.freeze({
        application: product.application,
        benchmark: `${product.benchmarkPath}${ENTRY_ROUTE}`,
        caseId: product.caseId,
        entry: `${product.launchPath}${ENTRY_ROUTE}`,
        id: product.id,
        label: product.label,
        renderer: product.renderer,
        responseMode: product.responseMode,
        streaming: product.streaming,
        transport: product.transport,
      })
    ),
  });
}
