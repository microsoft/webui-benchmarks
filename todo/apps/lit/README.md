<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# Lit benchmark app

This product implements the same 13-component workspace contract, state
variants, component-scoped CSS, and shared `node:http` transport as the other
product-renderer rows. It is a direct port of the WebUI FAST V3 row: both are
shadow-DOM web-component products with the same component boundaries, so the
pair isolates the framework from the rendering model.

## SSR

`server.mjs` renders through Lit's own SSR package, `@lit-labs/ssr`:

- `renderTodo` drains `render()` into one collected string for the complete
  response suite.
- `renderTodoStream` publishes Lit's native `RenderResultReadable`, adapted to a
  `ReadableStream`, for the progressive suite.

Output is **declarative shadow DOM** (`<template shadowrootmode="open">`), which
is Lit's best server rendering mode: the browser attaches the shadow roots
during parse, with no client work required to make the page visible.

The global `install-global-dom-shim` entry point is deliberately not used. The
benchmark loads several product renderers into one process, and a global
`window`/`document` leaks into peers that branch on their absence to select a
server code path. `@lit-labs/ssr` already installs its own scoped shim around
the element lifecycle, so the row renders correctly without polluting the
others.

## Hydration

`client.mjs` imports `@lit-labs/ssr-client/lit-element-hydrate-support.js`
before any component module, because Lit's hydration support has to be installed
before the first `LitElement` subclass is defined. The shell then receives its
state, clears `defer-hydration`, and Lit adopts the server-rendered shadow roots
instead of recreating them.

## Routing

`@lit-labs/router` drives client navigation and owns the lazy `enter` imports
for the two secondary pages, so `activity-page` and `settings-page` stay out of
the initial bundle. Note that this is Lit's official router but is still a
pre-1.0 `@lit-labs` package.

The router resolves routes asynchronously, which a synchronous SSR pass cannot
await, so `routes.mjs` holds the single route table that both sides read:
the server matches it with `matchRoute()`, and the browser hands the same paths
to the router. A route therefore cannot exist on only one of the two passes.
