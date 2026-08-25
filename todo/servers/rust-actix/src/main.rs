// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use anyhow::Result;
use ssr_framework_bench_todo_actix::{run, ServerConfig};

#[actix_web::main]
async fn main() -> Result<()> {
    run(ServerConfig::from_args(std::env::args().skip(1))?).await
}
