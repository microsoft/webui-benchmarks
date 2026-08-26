<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# WebUI benchmarks

This repository is the canonical home of the WebUI SSR framework benchmark
suite. It compares fourteen equivalent 100-item todo applications in one
official dynamic SSR matrix and keeps the browser hydration, interaction, raw
capture, profiling, and correctness evidence beside the runner that produced
it.

| # | Case id | Product SSR renderer | HTTP transport |
| --- | --- | --- | --- |
| 1 | `webui-rust-actix` | `webui-handler` `WebUIHandler` (Rust) | `actix-web` |
| 2 | `webui-shadowdom-rust-actix` | `WebUIHandler` (Rust, Shadow DOM) | `actix-web` |
| 3 | `webui-fast-rust-actix` | `WebUIHandler` (Rust, FAST V3) | `actix-web` |
| 4 | `webui-bun-serve` | `@microsoft/webui` `Protocol.render` | `Bun.serve` |
| 5 | `webui-deno-serve` | `@microsoft/webui` `Protocol.render` | `Deno.serve` |
| 6 | `webui-node-http` | `@microsoft/webui` `Protocol.render` | `node:http` |
| 7 | `sveltekit` | SvelteKit production SSR | `@sveltejs/adapter-node` |
| 8 | `nuxt` | Nuxt production SSR | nitro node-server |
| 9 | `next` | Next.js production App Router SSR | `next start` |
| 10 | `astro` | Astro production SSR + hydrated Preact island | `@astrojs/node` |
| 11 | `vue` | `@vue/server-renderer` `renderToString` | `node:http` |
| 12 | `preact` | `preact-render-to-string` `renderToString` | `node:http` |
| 13 | `react` | `react-dom/server` `renderToString` | `node:http` |
| 14 | `solid` | `solid-js/web` `renderToString` | `node:http` |

The WebUI rows isolate Light DOM, Shadow DOM, FAST V3 hydration, and four
runtime hosts. The production framework rows use their real production build
and server adapters. Product renderers without a canonical server share the
same minimal `node:http` transport.

## Reproducible setup

The official runtime pins are Node `22.23.1`, Bun `1.3.14`, Deno `2.9.5`,
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

The canonical manifests benchmark the released WebUI `0.0.25` npm packages
and `microsoft-webui-handler` crate. The package lock, Cargo lock, report
metadata, and fixture digest retain the exact resolved dependency evidence.

To benchmark an existing WebUI checkout without editing tracked manifests:

```bash
pnpm run webui:configure -- --path ../webui
pnpm install --force --no-frozen-lockfile --lockfile=false
pnpm run build
```

To benchmark a tag, branch, or commit, let the configuration script create an
untracked shallow checkout:

```bash
pnpm run webui:configure -- --ref v0.0.25
pnpm install --force --no-frozen-lockfile --lockfile=false
pnpm run build
```

`.pnpmfile.cjs` links the two npm packages from that checkout. Cargo receives a
per-command crates.io patch for `microsoft-webui-handler`, and the build plan
builds the checkout's npm packages and Node-API addon before the benchmark.
The local install leaves the canonical release lockfile untouched. Reports
record the checkout commit and dirty state. Return to released dependencies
with:

```bash
pnpm run webui:release
pnpm install --force --frozen-lockfile
```

`WEBUI_CHECKOUT` may be set instead of creating `.webui-local.json`.

## Run the benchmark

Run a quick smoke or select rows by case id, app id, kind, runtime, server, or
wildcard:

```bash
pnpm run bench:quick
pnpm run bench:quick -- --case react
pnpm run bench:quick -- --case webui-*
```

Run and save the official seven-round SSR matrix under a stable, descriptive
name:

```bash
pnpm run bench:ssr:save -- \
  --save-baseline 2026-08-25-windows-285k
```

Run the separate browser outcome tier or the one-round hydration gate:

```bash
pnpm run bench:browser:official -- \
  --output results/ssr-todo-browser-outcomes-2026-08-25-windows-285k.json
pnpm run bench:hydration-gate
```

Browser outcomes are never folded into headline SSR scoring. Every official
browser row uses HTTPS/HTTP2, real framework hydration, a fresh Chromium
process/context/page, and the shared interaction sequence.

## Result ownership and publishing

Full raw reports and named baselines belong in [`results/`](./results/).
CI runs may retain them as workflow artifacts. The WebUI documentation
repository does not need to check in a duplicate full `latest.json`.

Export only the compact homepage DTO from a clean, unfiltered, complete
seven-round official SSR report. Add the matching headed browser report when
the homepage should include browser metrics:

```bash
pnpm run export:summary -- \
  --input results/ssr-todo-2026-08-25-windows-285k.json \
  --browser-input results/ssr-todo-browser-outcomes-2026-08-25-windows-285k.json \
  --output results/benchmark-summary.json
```

The exporter writes only `{ benchmarks, benchmarksJson }`, matching the WebUI
homepage state contract; raw rounds, machine details, and full evidence remain
here. On Windows, an otherwise complete official report is intentionally marked
`partial` because synchronous process sampling would perturb load measurements.
The exporter accepts that status only when every case and round is complete and
all unavailable telemetry has the runner's documented Windows sampler reason.
When `--browser-input` is present, the exporter also requires matching source
and fixture digests, the canonical 1,440×900 headed Chromium methodology, seven
successful rounds for every product, and verified pinned runtimes. It adds FCP,
LCP, JavaScript heap, and renderer-private-memory metrics without retaining
stale browser data. Without that option, the DTO contains SSR throughput only.

Derive a WebUI-only state file from that compact summary with:

```bash
pnpm run export:webui -- --input results/benchmark-summary.json
```

The extractor writes `webui.json` beside the input by default. Pass
`--output <path>` to choose another location. It keeps only `webui-*` rows,
rebuilds each metric summary, re-ranks the filtered rows, and keeps
`benchmarksJson` synchronized with `benchmarks`.

## Measurement contract

- Dynamic SSR renders HTML for every measured request; final HTML is never
  cached in headline results.
- Thirty-two deterministic structural variants stay warm. Every timed request
  captures a unique current UTC timestamp and materializes it into all 100 todo
  items before rendering.
- Natural production bytes are measured without equal-byte padding.
- Every response is a complete hydratable document. Publication evidence
  requires real hydration and the shared filter, selection, toggle, and clear
  interactions.
- Every case uses one server process/worker pinned to one CPU, two load workers,
  and seven randomized official rounds.
- All apps retain the same 100-todo state, 12-component semantic graph,
  branches, loops, selectors, sentinels, route headers, and exact validation
  over all 32 variants.

See [`todo/shared/README.md`](./todo/shared/README.md) for the semantic fixture,
[`todo/browser/README.md`](./todo/browser/README.md) for browser methodology,
[`todo/servers/README.md`](./todo/servers/README.md) for runtime servers, and
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
    ├── profile/                # Rust profiling harness and methodology
    ├── runner/                 # Build graph, RPS runner, schema, reporting
    ├── servers/                # Node, Bun, Deno, and Rust/Actix servers
    └── shared/                 # Frozen state and correctness contract
```

## License

[MIT](./LICENSE)
