<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# Todo browser outcomes

This directory implements the **secondary** browser outcome tier for the frozen
todo SSR contract. Its JSON schema and output path are separate from the SSR
throughput runner, every case has `headline: false`, and these numbers must
never be presented as or merged into headline SSR scores.

The matrix is hydration-framework-only. Case construction fails if any product
declares attach-only/vanilla behavior or an unsupported hydration path; such a
product must be converted to real framework hydration or removed.

## Commands

Run from the repository root:

```powershell
# Official: build production outputs, then run exactly ten randomized rounds.
node todo\browser\cli.mjs --official --build

# One smoke round, optionally narrowed to apps.
node todo\browser\cli.mjs --quick --apps vue,react,next

# Launch all built production apps for manual testing; Ctrl+C stops all.
pnpm run preview:all

# Focused tests, including real Chromium interaction and React/Solid smoke coverage.
$tests = Get-ChildItem todo\browser\tests\*.test.mjs
node --test $tests.FullName
```

Reports default to
`results/ssr-todo-browser-outcomes-{official|quick}.json`.
`--output`, `--seed`, `--rounds` (official: 7), `--viewport`, and
`--headed` are available for diagnostics.

## Method

- Chromium is launched through the repository Playwright installation with a
  fresh process and context, blocked service workers, and a fixed
  1440×900 viewport for every raw round. In headed mode, the measured page
  receives two blank animation frames before navigation so visible
  window/compositor startup is not charged to a framework. The fresh context
  starts cold, while ordinary same-navigation reuse prevents hundreds of
  identical Shadow DOM stylesheet links from becoming artificial downloads.
- Every browser-facing URL is HTTPS with ALPN restricted to HTTP/2, and every
  raw navigation must report `nextHopProtocol: "h2"`. Actix uses rustls
  directly; controlled documents and built framework handlers are hosted
  directly by `node:http2` compatibility servers.
- Apps are deterministically shuffled per round. Only one production server is
  live at a time. Existing build plans, case metadata, production launchers,
  worker policy, and process-tree cleanup are reused.
- Primary evidence always navigates to `/dynamic`. The controlled apps use a
  browser-only document adapter around their natural dynamic SSR fragment;
  full-stack Next, Nuxt, SvelteKit, and Astro use their production server
  document directly. No full-response cache result enters primary evidence.
- WebUI / Light DOM / Rust / Actix is served directly by Actix with no Node
  document proxy.
  The Rust server injects the browser bootstrap through `RenderOptions` and
  serves both WebUI browser assets itself.
- WebUI / Shadow DOM / Rust / Actix uses that same direct server, state, and
  authored component graph. Only the compiled DOM/CSS strategy changes; browser
  evidence requires more than 800 open shadow roots.
- Controlled renderers receive their initial state once from the browser
  document adapter. WebUI already embeds its selected hydration state in
  `#webui-data`, so the adapter records `initialStateSource: "ssr-document"`
  and does not inject a duplicate global state object.
- Network CDP events report external executable JavaScript transfer bytes and
  request count. Inline JavaScript counts executable script text only. Serialized
  state in JSON scripts or element attributes remains part of document bytes;
  JavaScript transfer is not presented as total cross-framework boot payload.
- Navigation timing reports TTFB from `responseStart`, response download time,
  browser pre-request time from `requestStart`, request-to-first-byte, and FCP
  after response start so faster servers are not hidden by browser scheduling
  or display-frame quantization in the headline FCP value.
- First-byte, TTFB, pre-request, and backend/render phases remain in JSON as
  diagnostics. They are not ranked across direct-document, runtime-backed, and
  in-process renderer hosts because those boundaries are intentionally
  different. The SSR matrix is the server-performance comparison.
- Renderer-process memory maps the page session's CDP `ProcessTime` to
  `SystemInfo.getProcessInfo` before reading OS private/working-set bytes. This
  prevents the headed blank-page warmup renderer from being selected by a
  coincidentally larger CPU delta.
  Playwright reports the natural document body bytes. Navigation timing,
  FCP/LCP, long tasks, forced-GC DOM counters, JS heap, and the best available
  user-agent memory result are captured with an explicit `available` or
  `unavailable` status.
- Readiness is recorded per app. Controlled hydration clients publish a
  benchmark readiness mark after attachment plus two animation frames. Solid
  uses the same `generate: "ssr", hydratable: true` server artifact in the
  headline and browser tiers, paired with its browser client compiled with
  `generate: "dom", hydratable: true`.
  Full-stack readiness requires `load`, the complete semantic DOM, and two
  frames. Astro additionally waits for its `@astrojs/preact` `client:visible`
  island to remove the `ssr` marker. A vanilla-script Astro page is excluded
  because it is not a hydration-framework comparison.
- Every app publishes a framework-authored hydration-complete timestamp.
  `requestToFullHydrationMs` starts at
  `PerformanceNavigationTiming.requestStart`, so it includes dynamic server
  response time, HTML transfer, external assets, execution, and startup
  hydration. WebUI first publishes its painted SSR-shell readiness, then the
  runner wakes interaction hydration and records that JavaScript separately.
  Viewport-deferred components follow their framework policy and do not hold
  startup completion open while offscreen.
- Native viewport hydration is enabled only where the production framework
  supports it: WebUI uses `w-render="lazy"` with an `18rem` reservation on each
  todo row, Vue uses `hydrateOnVisible`, Nuxt uses `hydrate-on-visible`, and
  Astro uses `client:visible`. React, Preact, Solid, SvelteKit, and Next expose
  code splitting or selective scheduling but no built-in viewport hydration,
  so the benchmark records that capability as unavailable instead of adding a
  custom observer polyfill.
- WebUI Light and Shadow use `w-hydrate="interaction"` on the application shell
  with router intent preloading. Their authored graph and router load only when
  interaction begins; scriptless todo rows retain viewport rendering deferral.
- After readiness, 29 browser-local timings first exercise the realistic
  workbench: exact search for `todo-0050`, three matching facets, sorting, row
  selection, CSV export, schema-validated saved views, archive/reset,
  board/insights views, and recurrence scheduling. The journey then exercises
  pending/completed/all todo filters, selection, completion, clear completed,
  Activity filtering/expansion/read state, Settings toggle/density/save, and
  return navigation. Every route waits for framework-authored interactive
  readiness and validates semantic DOM state.
- JavaScript is split into startup, interaction-hydration, on-demand Work
  features, and route-transition transfer bytes. Search, Export, Save View,
  Insights, and Schedule each retain their own transfer breakdown. WebUI
  and FAST use `Router.start({ loaders })` so Activity and Settings are real
  dynamic imports. Framework-native route chunks are measured when their
  routers request them. Shared frozen server snapshots are hashed before and
  after the run.
- The production Preact client must emit at least 200 KiB. This floor is tested
  against the actual esbuild output, not source size or installed dependencies.

Summaries retain every raw round and report median, nearest-rank p95, and MAD
for each available numeric metric. Failures and unsupported measurements remain
explicitly unavailable and are never encoded as successful zeroes.
