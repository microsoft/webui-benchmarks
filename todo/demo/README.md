# Todo demo site

A single-container demo that hosts every todo application in the benchmark
suite, in both response-mode variants: **12 applications × 2 response modes =
24 hosted products** behind one HTTP port, which is what an Azure Container App
ingress exposes.

```
pnpm run demo                       # http://localhost:8080
pnpm run demo:docker:build          # docker build -f todo/demo/Dockerfile -t webui-todo-demo .
pnpm run demo:docker:run            # docker run --rm -p 8080:8080 webui-todo-demo
docker compose -f todo/demo/docker-compose.yml up --build
```

## What is hosted

The registry is derived from the official benchmark matrix
(`todo/runner/lib/cases.mjs`), so a product can never drift from the case it
demonstrates. The three alternate WebUI runtime hosts (Bun, Deno, Node) are
excluded because they run the same Light DOM application as the canonical
Rust/Actix host; every other official case is hosted twice:

| Response mode | Gallery label | Behaviour                                          |
| ------------- | ------------- | -------------------------------------------------- |
| `progressive` | Streaming     | The product keeps its native streaming boundaries.  |
| `complete`    | No streaming  | The product publishes one fully collected response. |

Each product runs the same production server the benchmark launches
(`launchCaseServer`): the framework production servers for Next, Nuxt,
SvelteKit and Astro, the shared `node:http` renderer transport for Preact,
React, React + TanStack, Solid and Vue, and the Rust/Actix WebUI server for the
three WebUI applications.

## Routing

Every application owns the root of its own URL space: the benchmark contract
fixes `/dynamic`, `/activity` and `/settings`, and each framework emits
root-absolute asset URLs (`/__browser/...`, `/_next/...`, `/_nuxt/...`). The
gateway therefore does not rewrite markup or strip a prefix:

1. `/app/{product}/{route}` is the launch entry point. It pins the product to
   the browsing session with an `HttpOnly` cookie and redirects to `{route}` on
   the demo origin. Gallery links and shared deep links both work.
2. Every other request is served by the pinned product at exactly the path the
   application emitted, so its router, its asset URLs and its module identities
   are byte-for-byte the benchmark artifact.
3. Anything else gets the gallery's not-found page.

One browsing session shows one product at a time; returning to `/` and
launching another product re-pins it. That is the price of giving each
application the unmodified root path it is measured on.

| Endpoint            | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `/`                 | Gallery of all 24 entry points.                            |
| `/app/{product}/…`  | Launch (pin + redirect).                                   |
| `/healthz`          | Liveness: always `200` once the gateway listens.           |
| `/readyz`           | Readiness: `503` until all 24 products are hosted.         |
| `/_demo/apps.json`  | Machine-readable registry of the hosted products.          |

## Hardening

- Only `GET` and `HEAD` are accepted; nothing else reaches a hosted server.
- Hop-by-hop headers, client cookies and inbound `X-Forwarded-*` headers are
  stripped before proxying; the gateway sets its own `X-Forwarded-*` values.
- Upstream `Set-Cookie` headers are dropped and upstream `Location` headers can
  never leave the demo origin or leak an internal loopback port.
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and (behind
  TLS) `Strict-Transport-Security` are set on every response.
- A per-client fixed-window rate limiter bounds the cost of an origin where
  every response is rendered dynamically (`--rate-limit`, `0` disables it).
- Header and request timeouts are bounded, and every hosted server is a child
  process tracked by the shared `ProcessRegistry`, so `SIGINT`/`SIGTERM` stops
  all 24 servers.

## Options

| Option            | Environment variable       | Default   |
| ----------------- | -------------------------- | --------- |
| `--port`          | `PORT`, `WEBUI_DEMO_PORT`  | `8080`    |
| `--host`          | `WEBUI_DEMO_HOST`          | `0.0.0.0` |
| `--concurrency`   | `WEBUI_DEMO_CONCURRENCY`   | `4`       |
| `--rate-limit`    | `WEBUI_DEMO_RATE_LIMIT`    | `600`     |

`--concurrency` bounds how many production servers boot at once. Twenty-four
servers take a few minutes to become ready on a small container, which is why
the image declares a long health-check start period and why `/readyz` must gate
any ingress probe.

## Tests

```
pnpm run test:todo:demo
```
