# Rust todo SSR profile

This directory profiles the generated 100-item WebUI todo application without
instrumenting or changing the production renderer. The harness uses:

- the generated componentized Light DOM protocol,
- the exact 32-state HTTP benchmark pool,
- a profile-only flat protocol proved byte-identical for every state, and
- a Shadow DOM protocol generated from the same source.

All generated manifests, protocols, Criterion data, and logs stay under
`target/todo-profile/`.

## Reproduce

Run from the repository root:

```sh
pnpm run profile:prepare

cargo test --manifest-path target/todo-profile/harness/Cargo.toml --all-targets
cargo clippy --manifest-path target/todo-profile/harness/Cargo.toml \
  --all-targets -- -D warnings

# Smoke, then the 60-sample suite.
cargo bench --manifest-path target/todo-profile/harness/Cargo.toml \
  --bench todo_profile -- --quick --noplot
cargo bench --manifest-path target/todo-profile/harness/Cargo.toml \
  --bench todo_profile -- --noplot

cargo run --release --quiet \
  --manifest-path target/todo-profile/harness/Cargo.toml \
  --bin inventory_probe > target/todo-profile/inventory.json
cargo run --release --quiet \
  --manifest-path target/todo-profile/harness/Cargo.toml \
  --bin allocation_probe > target/todo-profile/allocations.json
```

The reported renderer and writer values use three independent full passes:

```sh
cargo bench --manifest-path target/todo-profile/harness/Cargo.toml \
  --bench todo_profile -- --noplot --save-baseline actual-1 actual_render
cargo bench --manifest-path target/todo-profile/harness/Cargo.toml \
  --bench todo_profile -- --noplot --save-baseline writer-1 writer_replay
cargo bench --manifest-path target/todo-profile/harness/Cargo.toml \
  --bench todo_profile -- --noplot --save-baseline paths-1 state_path
```

Repeat with suffixes `-2` and `-3`. Criterion's machine-readable estimates are
under `target/todo-profile/harness/target/criterion/`.

The equal-byte, one-worker Actix ceiling is separate:

```sh
cargo test -p ssr-framework-bench-todo-actix \
  --example todo_profile_server
cargo clippy -p ssr-framework-bench-todo-actix \
  --example todo_profile_server -- -D warnings
cargo build --release -p ssr-framework-bench-todo-actix \
  --example todo_profile_server
node todo/profile/measure-actix.mjs \
  > results/profile/actix-results.json
```

`WEBUI_PROFILE_ACTIX_SECONDS`, `WEBUI_PROFILE_ACTIX_ROUNDS`, and
`WEBUI_PROFILE_ACTIX_WARMUP` override the defaults of 3 seconds, 5 rounds, and
2 seconds.

The diagnostic product-renderer subset can be run with:

```sh
node todo/runner/cli.mjs \
  --quick --skip-build --json --case webui-node-http,renderer \
  > results/profile/runner-renderer-quick.json
```

Quick runner results are smoke/diagnostic data, not publishable benchmark
numbers.

## Captured fixture

Captured on an Intel Core Ultra 9 285K, Windows 10.0.26200, Rust 1.93, and Node
22.23.1. Processes were not pinned, so the three-pass medians below are more
useful than any one pass.

| Input | Size | SHA-256 |
| --- | ---: | --- |
| Light DOM protocol | 20,719 B | `24edb88efab4ead32978c9c1ece7363ec4f59a9b678070521150e056d8516f7c` |
| Shadow DOM protocol | 22,402 B | `9818d09b2f46112bec1b4dc60b7733da933b4c6ab80a328239edc06570e2b05a` |
| 32-state pool | 3,570,441 B | `a750e32ab3bd145837de6c2b1da97c74da180546e3722c9d55756771b23d78c1` |

Protobuf bytes can change between otherwise identical builds because fragment
maps are serialized in non-stable map order. `prepare.mjs` records the hash for
each run; equivalence tests compare rendered bytes for all states.
After correctness declared the source final, the fixture was rebuilt again.
Its inventory and exact allocation reports were byte-identical to the
pre-rebuild reports, and all 32 flat/component output comparisons passed.

The Light protocol has 34 fragment records and 352 fragments: 135 raw, 81
attribute, 74 signal, 24 component, 20 plugin, 15 condition, and 3 loop
fragments. Without the hydration bootstrap, the mean Light response is
175,448 B (175,143-175,721 B). Shadow DOM averages 327,881 B
(327,180-328,482 B) with the same Link CSS strategy.
The production hydration plugin raises the natural HTTP response to
332,831-333,536 B for Light and 486,149-487,578 B for Shadow after authored
initial-state projection.

One representative core render performs 1,144-1,150 signals, 1,502 conditions,
620-624 true condition bodies, 202-204 loop items, and 829-833 component scope
entries. Across the pool it makes 8,680-8,720 writer calls (mean 8,701);
about 2,046 calls emit fewer than eight bytes. A 4 KiB accumulator reduces
the representative 8,687 calls to 45.

## Final optimized outcome

The accepted changes are general runtime optimizations, not todo-specific
special cases:

- numeric fragment targets, canonical component property keys, and four-slot
  borrowed component scopes;
- a compact borrowed fragment index that avoids duplicating the decoded
  protocol graph;
- buffer-backed attribute hooks that write complete attributes without
  intermediate allocation; and
- a startup-computed route-presence bit that skips sibling-route scans for
  fragment lists that cannot contain routes; and
- an allocation-free request-local fragment pointer cache that resolves only
  lists actually visited, avoiding whole-protocol scans for large multi-route
  applications.

The last two optimizations were measured with interleaved local controls. The
attribute hook reduced the three-pass median from 437.83 us to 417.12 us
(4.7%). Route-presence indexing then reduced the median from 412.33 us to
394.00 us (4.4%). Different machine power states shifted absolute Criterion
values, so only adjacent control/experiment pairs are used for percentages.

The final writer inventory emits the 180,428 B representative core response in
8,696 calls. Calls of eight bytes or less are 2,046. Exact core render
allocations remain 686 calls and 14,215 requested bytes, excluding the
preallocated output buffer.

Protocol preparation also improved independently: retained fragment-index
memory fell from 86,530 B to 16,123 B, preparation from 80.60 us to 44.15 us,
and decode-plus-prepare retained memory from 196,054 B to 125,647 B.

The official hydratable-response HTTP matrix measured WebUI Rust/Actix at
1,408.9 req/s. The fastest non-WebUI row, React, measured 567.7 req/s, so
WebUI Rust delivered 148.2% higher median throughput. Shadow DOM reached
1,067.7 req/s after Link CSS removed repeated inline style text. See the generated
performance page for all thirteen rows, MAD, p95 latency, and byte ranges.

### Why Actix, Bun, Deno, and Node converge

All WebUI runtime rows execute the same release-built Rust renderer. Node, Bun,
and Deno retain the 32 immutable structural variants, then materialize the
current request timestamp and call `render` per request. JSON serialization,
native parsing, timestamp state construction, and SSR are all included in the
headline request path rather than hidden in startup preparation. Rust/Actix
keeps one mutable request shape per variant and rewrites only dynamic strings.

Final isolated and official measurements attribute the request cost as follows:

| Layer | Result |
|---|---:|
| Core Rust render, representative adjacent control | 373.78 us |
| Production hydratable Rust render, fresh output | 549.71 us |
| Hydratable render plus Actix `HttpResponse` | 570.31 us |
| Cached `Bytes` response construction | 0.210 us |
| Fresh 344 KB body plus response construction | 5.30 us |
| Previous deep-clone request-state phase | 414 us |
| Reused request-state rewrite phase | 81 us |
| Official Rust/Actix service time (`1 / 1,408.9`) | 709.77 us |
| Official Deno service time (`1 / 769.2`) | 1,299.79 us |
| Official Node service time (`1 / 744.5`) | 1,343.18 us |
| Official Bun service time (`1 / 703.5`) | 1,421.46 us |

Absolute Criterion values move with hybrid-CPU scheduling, so only adjacent
control/experiment deltas are used for optimization claims. The isolated
constructors establish that response construction is negligible. Request-state
reuse improved a pinned adjacent HTTP control from 1,014 to 1,306.8 req/s, or
28.9%, while preserving every rendered byte.

All 91 official measurements retained complete latency histograms and available
load-generator evidence. The complete matrix reported zero errors, timeouts, or
non-2xx responses.

## Pre-optimization renderer baseline

Criterion used 2 seconds of warmup, 5 seconds of measurement, and 60 samples.
Values are the median of the mean estimate from three independent passes; the
range is the minimum and maximum pass mean.

| Scenario | Median | Pass range | Relative to component/reused |
| --- | ---: | ---: | ---: |
| Light component, reused output | **545.4 us** | 530.1-564.9 us | baseline |
| Equivalent flat Light, reused output | 384.6 us | 377.1-391.3 us | **-29.5%** |
| Shadow component, reused output | 549.8 us | 534.2-603.9 us | +0.8% |
| Light component, count-only output | 520.7 us | 500.8-527.5 us | -4.5% |
| Light component, fresh output | 570.1 us | 550.7-651.4 us | +4.5% |
| Render plus `HttpResponse` | 551.8 us | 519.1-559.1 us | within run noise |
| Cached `Bytes` response construction | 0.240 us | 0.233-0.243 us | 0.04% |
| Fresh equal-byte body plus response | 3.37 us | 3.24-3.44 us | 0.62% |
| Atomic state rotation | 0.008 us | 0.008-0.008 us | negligible |

Light and Shadow component CPU are close even though Shadow emits 20.8% more
bytes. Fresh-buffer and render-plus-response confidence ranges overlap the
reused render, while the isolated response benchmarks show that response
construction is not a leading cost.

### Writer calls

| Replay of the same 171,999 B output | Median | Pass range |
| --- | ---: | ---: |
| Original 19,021 calls | 43.59 us | 42.72-44.12 us |
| 43 batches of at most 4 KiB | 3.14 us | 3.11-3.32 us |
| One call | 2.25 us | 2.16-2.73 us |

Batching recovers 40.5 us, or **7.4%** of the component render. The noisier
count-only result is directionally consistent. The call boundary, rather than
copying 172 KiB, is the relevant output cost.

### Focused costs

Each synthetic protocol renders 100 items. Primitive groups perform 256
operations per Criterion iteration.

| Isolation | Result |
| --- | --- |
| Component with no attributes vs flat | 12.20 vs 5.59 us/100; 66.1 ns per component boundary |
| One propagated attribute vs matching flat form | 17.98 vs 6.28 us/100 |
| Four propagated attributes vs matching flat form | 41.34 vs 12.14 us/100 |
| Attribute-only component overhead after boundary subtraction | 50.9 ns/attribute at one attribute; 56.5 ns/attribute at four |
| True dotted condition vs raw body | 9.66 vs 3.69 us/100 |
| Two-segment path, string vs pre-split | 9.54 vs 8.46 us/256; pre-split is 11.3% faster |
| Three-segment path, string vs pre-split | 8.28 vs 5.02 us/256; pre-split is 39.4% faster |
| String hash fragment lookup vs numeric index | 3.74 vs 0.34 us/256; numeric is 90.9% faster |
| Safe vs escaping HTML input | 3.26 vs 22.67 us/256; escaping is 7.0x the safe scan |
| Split owned/borrowed maps vs one enum map | 7.02 vs 6.96 us/100; no material standalone difference |
| Split maps vs four precomputed slots | 7.02 vs 0.08 us/100; slots remove 98.9% of this synthetic map work |

The real fixture contains only one- and two-segment state paths. The
three-segment result is retained as a scaling diagnostic, not used to estimate
the fixture opportunity.

### Exact allocations

The allocator is enabled only around one warmed render. Reused and count-only
writers are allocated before counting; fresh writers are created and dropped
inside the measurement.

| Protocol/mode | Alloc calls | Realloc calls | Initial allocated bytes | Reallocated bytes |
| --- | ---: | ---: | ---: | ---: |
| Light component, reused/count-only | 686 | 306 | 14,215 | 14,094 |
| Flat Light, reused/count-only | 580 | 306 | 9,359 | 14,094 |
| Shadow component, reused/count-only | 1,598 | 366 | 117,439 | 59,065 |
| Light component, fresh including output | 687 | 306 | 195,120 | 14,094 |

These counts are identical for all 32 variants. Fresh Light output adds exactly
one 180,905-byte capacity allocation; fresh Shadow output uses 901,800 bytes.
Componentization adds 106 allocation calls and 4,856 requested bytes over flat
rendering; the remaining CPU gap is lookup, propagation, and dispatch work.

No 1,000-item allocation result is reported: the shared generator and
validator intentionally fix the contract at exactly 100 items.

## Actix renderer versus network delivery

The initial Actix decomposition used synchronous PowerShell process sampling on
Windows. Those probes blocked the load-generator event loop and invalidated the
throughput values, so they were discarded. The final runner disables Windows
process sampling during load and keeps CPU sampling as an explicitly
unavailable optional diagnostic.

The publishable Actix result comes from seven randomized ten-second rounds at
64 connections from two load workers, with one release-build server worker
pinned to one CPU. It renders a fresh natural response on every request and
records 1,408.9 req/s median, 5.5 req/s MAD, and 47.84 ms median p95 latency
for 332,831-333,536 B responses.

## Product renderer diagnostic

Quick subset runs are smoke and profiling evidence only. They do not use the
complete official matrix and cannot support a cross-product ranking. A
publishable result requires all fourteen rows under the normal pinned,
timeboxed protocol plus one successful hydration and interaction gate round per
product.

## Optimization decisions

Accepted changes had to improve repeated medians, preserve all 32 rendered
outputs, and remain useful for arbitrary protocols:

1. Numeric fragment targets, canonical property names, and borrowed scope slots
   removed repeated string dispatch and map work.
2. Compact borrowed fragment metadata removed a complete duplicate protocol
   graph while improving preparation and render CPU.
3. Complete-attribute writer hooks removed 10,743 write calls without adding a
   scratch copy or allocation.
4. Route-presence metadata moved an invariant fragment scan to protocol startup.
5. Lazy fragment pointer caching made render startup O(1) in total protocol
   size while preserving indexed repeated-list access for the common first 64
   lists.

Measured experiments that did not clear the noise threshold were removed:

- copying attributes through a reusable scratch string;
- speculative template-attribute capacity hints;
- a single-key JSON state lookup shortcut;
- a second component-seen bitset beside the existing inventory set; and
- standalone unified scope maps.

Response pooling also remains rejected for this workload. Cached `Bytes`
response construction measured about 0.21 us and a fresh equal-byte 344 KB
body plus response about 5.30 us, too small to explain renderer cost.

## Validation

- All 32 state variants remain byte-identical across component and equivalent
  flat protocols.
- The final writer inventory and allocation probes ran in release mode.
- Every accepted CPU change used three Criterion passes and an adjacent control.
- Handler, Node-native, benchmark integration, hydration, and browser interaction
  suites pass.
- The official matrix completed all 98 measurements: fourteen products times
  seven randomized rounds.
- The full repository quality gate is the final required check before commit.

## Artifacts

The measured run retained:

- `target/todo-profile/fixture-metadata.json`
- `target/todo-profile/inventory-writer-hook.json`
- `target/todo-profile/allocations-writer-hook.json`
- `target/todo-profile/criterion-summary.json`
- `target/todo-profile/criterion-*.log`
- `target/todo-profile/harness/target/criterion/`
- `results/ssr-todo-<name>.json`
