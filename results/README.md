<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# Benchmark results

This directory owns full SSR reports, browser outcome reports, hydration-gate
captures, profiling evidence, and compact homepage exports.

Use descriptive, immutable names that identify the capture date and machine or
CI run, for example:

```text
ssr-todo-2026-08-25-windows-285k.json
ssr-todo-browser-outcomes-2026-08-25-windows-285k.json
benchmark-summary.json
```

`target/` remains disposable build output. Do not move full raw captures into
the WebUI documentation repository; publish only `benchmark-summary.json` when
the homepage needs an update.
