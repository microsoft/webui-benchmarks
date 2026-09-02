<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# WebUI benchmarks

This repository is the canonical home of the WebUI SSR framework benchmark
suite. It compares fifteen equivalent routed workspace applications in one
official dynamic SSR matrix and keeps the browser hydration, interaction, raw
capture, profiling, and correctness evidence beside the runner that produced
it.

| # | Case id | Product SSR renderer | HTTP transport |
| --- | --- | --- | --- |
| 1 | `webui-rust-actix` | `webui-handler` `StreamingResponse` (Rust) | `actix-web` |
| 2 | `webui-shadowdom-rust-actix` | `StreamingResponse` (Rust, Shadow DOM) | `actix-web` |
| 3 | `webui-fast-rust-actix` | chunked `ResponseWriter` (Rust, FAST V3) | `actix-web` |
| 4 | `webui-bun-serve` | `@microsoft/webui` `Protocol.streamResponse` | `Bun.serve` |
| 5 | `webui-deno-serve` | `@microsoft/webui` `Protocol.streamResponse` | `Deno.serve` |
| 6 | `webui-node-http` | `@microsoft/webui` `Protocol.streamResponse` | `node:http` |
| 7 | `sveltekit` | SvelteKit production SSR | `@sveltejs/adapter-node` |
| 8 | `nuxt` | Nuxt production SSR | nitro node-server |
| 9 | `next` | Next.js production App Router SSR | `next start` |
| 10 | `astro` | Astro production SSR + hydrated Preact island | `@astrojs/node` |
| 11 | `vue` | `@vue/server-renderer` `renderToWebStream` | `node:http` |
| 12 | `preact` | `preact-render-to-string` `renderToReadableStream` | `node:http` |
| 13 | `react` | `react-dom/server` `renderToReadableStream` | `node:http` |
| 14 | `react-tanstack` | React stream + TanStack Router `renderRouterToStream` | `node:http` |
| 15 | `solid` | `solid-js/web` `renderToStream` | `node:http` |

The WebUI rows isolate Light DOM, Shadow DOM, FAST V3 hydration, and four
runtime hosts. The production framework rows use their real production build
and server adapters. Product renderers without a canonical server share the
same minimal `node:http` transport.

Dynamic responses use each renderer's native streaming surface. WebUI Light
and Shadow use semantic streaming boundaries; FAST uses a chunked writer;
React, Preact, Vue, Solid, and TanStack use their native stream renderers.
Next.js and Astro stream through their production servers. The synchronous
SvelteKit and Nuxt routes retain their production servers' buffered
`Content-Length` responses rather than simulating application suspension.

Every browser product exposes the same three-page workspace:

| Page | Path | Canonical interactions |
| --- | --- | --- |
| Work queue | `/dynamic` | exact/fuzzy search, status/priority/assignment facets, sorting, table/board/insights views, row and bulk selection, archive, saved views, CSV export, recurrence scheduling, plus todo filter/select/toggle/clear |
| Activity | `/activity` | filter deployments, expand an event, mark all read |
| Settings | `/settings` | toggle a preference, select density, save |

WebUI and FAST use `@microsoft/webui-router` with dynamically imported route
components. React uses React Router, the separate `react-tanstack` row uses
TanStack Router's SSR pipeline, Preact uses `preact-iso`, Vue uses Vue Router,
and Solid uses Solid Router. Next, Nuxt, SvelteKit, and Astro use their native
production routers. All rows render the same state, markup semantics, controls,
and shared stylesheet.

The Work queue intentionally carries a realistic client workload rather than a
small demo. Every product provides the same MiniSearch index, deterministic
table model, D3 analytics, Zod saved-view validation, Immer reducers, date-fns
formatting, and RRule schedule previews. The production Preact browser bundle
is required by test to emit at least 200 KiB, preventing accidental regression
to a toy comparison.

## Reproducible setup

The official runtime pins are Node `24.19.0`, Bun `1.3.14`, Deno `2.9.5`,
Rust `1.98`, and pnpm `11.5.3`. Framework and adapter versions are exact in
their package manifests.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run verify:runtimes
pnpm run build
pnpm test
```

`pnpm run build` creates every controlled renderer, Rust server, TLS helper,
and production framework output. Generated `dist`, `target`, framework cache,
and `node_modules` trees are intentionally untracked.

## WebUI dependency strategy

The canonical manifests benchmark the released WebUI `0.0.28` npm packages
and `microsoft-webui-handler` crate. The package lock, Cargo lock, report
metadata, and fixture digest retain the exact resolved dependency evidence.

Use source-link mode for the fastest development loop. It builds WebUI,
WebUI Framework, and WebUI Router from any checkout, mirrors their publishable
outputs into an ignored same-volume snapshot, and redirects only those package
links without changing pnpm's canonical dependency graph or lockfile. The
same-volume snapshot also supports checkouts on another drive. Cargo commands
patch the local Rust handler directly, and protocol builds use the checkout's
native addon:

```powershell
pnpm run webui:local -- --path E:\path\to\webui
pnpm run build
```

`pnpm run build` refreshes the source snapshot automatically. It can also be
refreshed explicitly with `pnpm run webui:sync`.

Use `--ref` instead of `--path` to create an untracked shallow checkout:

```bash
pnpm run webui:local -- --ref v0.0.28
pnpm run build
```

Packed mode builds those three npm packages and installs immutable tarballs.
It is slower but exercises the package contents that would be published while
continuing to patch the Rust handler from the same checkout:

```powershell
pnpm run webui:packed -- --path E:\path\to\webui
pnpm run build
```

Inspect the active checkout, commit, dirty state, package sources, Cargo patch,
native addon, and whether a packed snapshot is stale with:

```bash
pnpm run webui:status
```

Run an arbitrary benchmark-workspace Cargo command with the same local patch:

```bash
pnpm run webui:cargo -- test --workspace
```

Both local modes leave the canonical release manifests and lockfiles untouched.
Reports record the checkout commit, mode, artifacts, and dirty state. Return to
released dependencies and restore the frozen lockfile with:

```bash
pnpm run webui:release
```

`pnpm run webui:configure -- --path <checkout>` remains available as the
lower-level configuration-only operation. Existing `WEBUI_CHECKOUT` workflows
remain supported when the caller manages its pnpm links.

## Run the benchmark

Run the complete publication workflow from a clean commit:

```bash
pnpm run bench:official
```

This runs the official SSR matrix in **both** response-mode suites (see
[Response-mode suites](#response-mode-suites) below), the ten-round headed
browser matrix, and both summary exports, all from the same source snapshot.
It writes:

- `results/ssr-todo-official.json` - complete raw progressive-suite SSR/RPS evidence
- `results/ssr-todo-official-complete.json` - complete raw complete-suite SSR/RPS evidence
- `results/ssr-todo-browser-outcomes-official.json` - complete raw browser evidence (progressive)
- `results/benchmark-summary.json` - copy-ready WebUI homepage state (complete and progressive RPS + essential browser metrics)
- `results/benchmark-summary-complete.json` - copy-ready homepage state for the complete suite (SSR only)

Run a quick smoke or select rows by case id, app id, kind, runtime, server, or
wildcard:

```bash
pnpm run bench:quick
pnpm run bench:quick -- --case react
pnpm run bench:quick -- --case webui-*
```

Run only the official timeboxed SSR matrix when investigating server results.
Each product gets two four-second saturation probes, a three-second warmup, and
one twenty-second measured round. The SSR report publishes per-framework RPS,
latency, and peak server RSS measured during that RPS window for both response
modes:

```bash
pnpm run bench:ssr:save -- \
  --save-baseline 2026-08-25-windows-285k
```

Run only one response-mode suite explicitly:

```bash
pnpm run bench:ssr:streaming:official   # progressive suite (native streaming, unchanged)
pnpm run bench:ssr:complete:official    # complete suite (one buffered HTML response)
```

Run the separate browser outcome tier or the one-round hydration gate:

```bash
pnpm run bench:browser:official -- \
  --output results/ssr-todo-browser-outcomes-2026-08-25-windows-285k.json
pnpm run bench:browser:streaming:official
pnpm run bench:hydration-gate
```

`bench:browser:streaming:official` is an explicit alias for
`bench:browser:official`: the browser suite always measures a product's real
page load, so it always exercises native progressive/streaming boundaries
end to end. There is no separate buffered-complete browser variant yet (see
[Response-mode suites](#response-mode-suites)).

Launch every built production browser product concurrently for manual testing:

```bash
pnpm run preview:all
```

The command prints each HTTPS URL and keeps every server alive until Ctrl+C.

Host all 24 demo products (12 applications × both response modes) behind a
single port, which is what the container image deploys:

```bash
pnpm run demo
```

See [`todo/demo/README.md`](todo/demo/README.md) for the routing model, the
hardening the gateway applies, and the Docker/Azure Container App image.

Browser outcomes are never folded into headline SSR scoring. Every official
browser row uses HTTPS/HTTP2, real framework hydration, a fresh Chromium
process/context/page, and the shared interaction sequence.

## Response-mode suites

The official 15-row product matrix is measured in two response-mode suites.
Product identity (case id, app id, transport, runtime) never changes between
them: only the response contract does. Every case exposes a `responseMode`
field (`complete` or `progressive`), and reports never mix the two: a report's
`policies.responseMode` and every one of its `cases[].responseMode` must
agree, or `assertReportSchema`/`assertCaseMatrix` reject it.

### Complete suite (`bench:ssr:complete:official`)

All data is ready before the response starts; every product publishes exactly
one fully collected HTML response. Primary metrics: completion
requests/second, p95 latency, render CPU, response bytes, and memory.

- **WebUI Rust (Light DOM, Shadow DOM, FAST V3)** always calls
  `WebUIHandler::render` -- never `render_streaming` -- directly in the single
  Actix worker and answers with one `Content-Length` response. It does not
  allocate the progressive suite's render thread or projected worker-state
  clone (`todo/servers/rust-actix/src/lib.rs`).
- **WebUI JS runtimes (Bun/Deno/Node) and the controlled renderer tier**
  (React, Vue, Preact, Solid, React + TanStack Router) call each app's own
  `render()` adapter -- the same complete-response API (`renderToString`,
  `renderRouterToString`, ...) they already shipped alongside `renderStream()`
  -- instead of collecting the native stream (`todo/servers/lib/contract.mjs`).
- **SvelteKit and Nuxt** were already buffered in the progressive suite (their
  production adapters have no native streaming path), so both suites measure
  the identical mechanism for them.
- **Next.js and Astro** own their entire production HTTP server; there is no
  in-repo request handler to call directly. The complete suite loads
  `todo/runner/lib/response-buffer-preload.cjs` in that same process (via
  `NODE_OPTIONS=--require`, never an external reverse proxy) to buffer every
  `http.ServerResponse` write and publish the body in one piece, honestly
  labeled `"...fully collected at the framework's own Node http.Server
  response boundary..."` in the case's `renderer` string.

### Progressive suite (`bench:ssr:streaming:official`, the historical default)

Preserves every product's existing native streaming/progressive-boundary
behavior unchanged: WebUI Light/Shadow DOM progressive boundaries, FAST V3
native chunked delivery, React/Preact/Vue/Solid/TanStack native streams,
Next/Astro native streaming, SvelteKit/Nuxt buffered (they have no native
stream to preserve). Primary metrics: time to first meaningful boundary,
FCP/LCP (browser suite), tail completion, and occupied render/CPU time.
Completion RPS, bytes, and disclosed chunk/flush counts are secondary,
disclosed costs -- not the primary ranking -- for this suite.

Running `pnpm run bench:ssr:official` (no `--response-mode`) or calling
`createCaseMatrix()` with no arguments is exactly this suite: response-mode
selection is fully opt-in and changes nothing by default.

### Async data-boundary follow-up (not yet active)

The approved design also calls for a deterministic async data-boundary
workload in the progressive suite: an above-the-fold shell/workbench that
renders immediately, with the below-the-fold todo list resolving later through
a shared, configured async readiness delay, driven for WebUI by its
resumable `StreamingSession` boundary API. The canonical WebUI dependency
(`@microsoft/webui@0.0.28`; see `todo/runner/lib/cases.mjs`'s
`ASYNC_DATA_BOUNDARY_CAPABILITY`) exposes that API, but the dedicated workload
is not implemented yet. This gap is disclosed as metadata
(`status: "available-pending-benchmark-implementation"`) and the progressive
suite continues to measure each product's existing native streaming boundaries
unchanged.

## Result ownership and publishing

Full raw reports and named baselines belong in [`results/`](./results/). CI runs
may retain them as workflow artifacts. Copy `results/benchmark-summary.json`
into the WebUI documentation state; do not copy either raw report.

Export only the compact homepage DTO from a clean, unfiltered, complete
canonical official SSR report. Add the matching headed browser report when
the homepage should include browser metrics:

```bash
pnpm run export:summary -- \
  --input results/ssr-todo-2026-08-25-windows-285k.json \
  --complete-input results/ssr-todo-2026-08-25-windows-285k-complete.json \
  --browser-input results/ssr-todo-browser-outcomes-2026-08-25-windows-285k.json \
  --output results/benchmark-summary.json
```

The exporter writes only `{ benchmarks, benchmarksJson }`, matching the WebUI
homepage state contract; raw rounds, machine details, and full evidence remain
here. On Windows, an otherwise complete official report is intentionally marked
`partial` because synchronous process sampling would perturb load measurements.
The exporter accepts that status only when every case and round is complete and
all unavailable telemetry has the runner's documented Windows sampler reason.
When `--browser-input` is present, the exporter also requires the same clean
source commit, independently verified fixture integrity, the canonical
1,440×900 headed Chromium methodology, ten successful rounds for every product,
and verified pinned runtimes. With `--complete-input`, the homepage DTO exposes
exactly five selectors: No Streaming RPS, Streaming RPS, LCP, JavaScript heap,
and renderer-private memory. Without it, the DTO remains a single-suite export.

Derive a WebUI-only state file from that compact summary with:

```bash
pnpm run export:webui -- --input results/benchmark-summary.json
```

The extractor writes `webui.json` beside the input by default. Pass
`--output <path>` to choose another location. By default it keeps only the
canonical `webui-rust-actix` row. Pass `--all` to retain the Shadow DOM, FAST,
Bun, Deno, and Node WebUI variants too:

```bash
pnpm run export:webui -- \
  --input results/benchmark-summary.json \
  --all
```

The extractor rebuilds each metric summary, re-ranks the filtered rows, and
keeps `benchmarksJson` synchronized with `benchmarks`.

## Measurement contract

- Dynamic SSR renders HTML for every measured request; final HTML is never
  cached in headline results.
- Thirty-two deterministic structural variants stay warm. Every timed request
  captures a unique current UTC timestamp and materializes it into all 100 todo
  items before rendering.
- Natural production bytes are measured without equal-byte padding.
- Every response is a complete hydratable document. Publication evidence
  requires real hydration and the 29-step shared workbench/todo interaction
  sequence, followed by the canonical Activity and Settings route journey.
- Browser evidence covers the full request-to-interactive lifecycle, startup
  JavaScript, interaction-hydration JavaScript, on-demand feature JavaScript,
  lazy route JavaScript, and interactive route navigation—not only component
  render time. WebUI Light and Shadow use `w-hydrate="interaction"` on the
  server-rendered application shell; Search, Export, Save View, Insights, and
  Schedule load separate feature chunks on first use.
- Every case uses one server process/worker pinned to one CPU, two load workers,
  two four-second saturation probes, a three-second warmup, and one twenty-second
  official measured round.
- All apps retain the same 100-todo state, 13-component semantic graph,
  branches, loops, selectors, sentinels, route headers, and exact validation
  over all 32 variants.

See [`todo/shared/README.md`](./todo/shared/README.md) for the semantic fixture,
[`todo/browser/README.md`](./todo/browser/README.md) for browser methodology,
[`todo/servers/README.md`](./todo/servers/README.md) for runtime servers,
[`todo/demo/README.md`](./todo/demo/README.md) for the hosted demo site, and
[`todo/profile/README.md`](./todo/profile/README.md) for Rust renderer
decomposition.

## Repository layout

```text
.
├── scripts/                    # Dependency setup and compact export
├── results/                    # Named raw captures and summary DTOs
└── todo/
    ├── apps/                   # WebUI and production framework apps
    ├── browser/                # Hydration and interaction measurements
    ├── demo/                   # Single-container demo site for all 24 products
    ├── profile/                # Rust profiling harness and methodology
    ├── runner/                 # Build graph, RPS runner, schema, reporting
    ├── servers/                # Node, Bun, Deno, and Rust/Actix servers
    └── shared/                 # Frozen state and correctness contract
```

## License

[MIT](./LICENSE)
