# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

# Single-container demo image: one gateway port in front of all 24 hosted todo
# products. Build from the repository root:
#
#   docker build -f todo/demo/Dockerfile -t webui-todo-demo .
#
# The builder stage produces the same artifacts as `pnpm run build` (every
# framework production build plus the Rust/Actix WebUI server), and the runtime
# stage runs them behind `todo/demo/cli.mjs`.

# The Rust toolchain is pinned by `rust-toolchain.toml`; taking it from the
# official image keeps the build reproducible and offline-friendly.
FROM rust:1.98-bookworm AS rust

FROM node:24.19.0-bookworm AS builder

ENV CARGO_HOME=/usr/local/cargo \
    CARGO_TERM_COLOR=never \
    PATH=/usr/local/cargo/bin:$PATH \
    RUSTUP_HOME=/usr/local/rustup

COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup

RUN apt-get update \
    && apt-get install --no-install-recommends --yes build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY .pnpmfile.cjs package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY todo/apps/astro/package.json todo/apps/astro/
COPY todo/apps/next/package.json todo/apps/next/
COPY todo/apps/nuxt/package.json todo/apps/nuxt/
COPY todo/apps/sveltekit/package.json todo/apps/sveltekit/
COPY todo/apps/webui-fast/package.json todo/apps/webui-fast/
COPY todo/apps/webui-shadowdom/package.json todo/apps/webui-shadowdom/
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:24.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    WEBUI_DEMO_CONCURRENCY=4 \
    WEBUI_DEMO_RATE_LIMIT=0

WORKDIR /app
COPY --from=builder --chown=node:node /app /app

USER node
EXPOSE 8080

# Readiness succeeds only after all products have launched and warmed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
    CMD ["node", "todo/demo/healthcheck.mjs"]

ENTRYPOINT ["node", "todo/demo/cli.mjs"]
