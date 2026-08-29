// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use anyhow::Result;
use mimalloc::MiMalloc;
use ssr_framework_bench_todo_actix::{run, ServerConfig};

// The dynamic streaming path runs two concurrently-active OS threads per request
// (the Actix HTTP worker and the dedicated WebUI render worker), both allocating
// heavily while building large HTML chunks. The platform default allocator (a
// single global lock on Windows, and similarly contended on many Linux libc
// builds) serializes those threads' allocations, inflating render wall-clock
// time under concurrent load even though the two threads never wait on each
// other's channels or locks. mimalloc uses per-thread heaps to avoid that
// cross-thread contention, restoring genuine overlap between rendering and
// HTTP body delivery.
//
// Isolated benchmarking (4 configurations: baseline, mimalloc-only,
// render-scratch-buffer-reuse-only, combined; 4 repeated passes against the
// same local WebUI build) confirmed mimalloc alone is a consistent win
// (median +9.3% req/s across passes) with no observed regression, so it is
// kept unconditionally rather than behind a runtime/feature toggle.
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[actix_web::main]
async fn main() -> Result<()> {
    run(ServerConfig::from_args(std::env::args().skip(1))?).await
}
