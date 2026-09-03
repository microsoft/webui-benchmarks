# Todo demo site

A single-container demo that offers every todo application in the benchmark
suite, in both response-mode variants: \*\*13 applications × 2 response modes =
26 products** behind one HTTP port, which is what an Azure Container App
ingress exposes. Startup launches every production server and warms its
`/dynamic` route three times before readiness succeeds.

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

Each product starts once during container initialization and runs the same production server the benchmark launches
(`launchCaseServer`): the framework production servers for Next, Nuxt,
SvelteKit and Astro, the shared `node:http` renderer transport for Preact,
React, React + TanStack, Solid, Vue and Lit, and the Rust/Actix WebUI server for the
three WebUI applications.

## Routing

Every application owns the root of its own URL space: the benchmark contract
fixes `/dynamic`, `/activity` and `/settings`, and each framework emits
root-absolute asset URLs (`/__browser/...`, `/_next/...`, `/_nuxt/...`). The
gateway therefore does not rewrite markup or strip a prefix:

1. `/benchmark/{product}/{route}` is the stable RPS endpoint. It proxies
   directly to the selected product without a redirect or cookie; the upstream
   framework receives the unprefixed benchmark route.
2. `/app/{product}/{route}` pins an interactive browsing session with an
   `HttpOnly` cookie and redirects to the origin root required by every
   framework's client router.
3. Every other request is served by the pinned product at exactly the path the
   application emitted, so its router, its asset URLs and its module identities
   are byte-for-byte the benchmark artifact.
4. Anything else gets the gallery's not-found page.

One browsing session shows one product at a time; returning to `/` and
launching another product re-pins it. That is the price of giving each
application the unmodified root path it is measured on.

| Endpoint            | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `/`                 | Gallery of all 24 entry points.                            |
| `/benchmark/{product}/…` | Stable, cookie-free RPS endpoint with no redirect. |
| `/app/{product}/…`  | Interactive launch (pin + redirect to framework root).      |
| `/healthz`          | Liveness: always `200` once the gateway listens.           |
| `/readyz`           | `200` only when all products are running and warmed.         |
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
- Header and request timeouts are bounded, and every launched server is a child
  process tracked by the shared `ProcessRegistry`, so `SIGINT`/`SIGTERM` stops
  every running product.

## Options

| Option            | Environment variable       | Default   |
| ----------------- | -------------------------- | --------- |
| `--port`          | `PORT`, `WEBUI_DEMO_PORT`  | `8080`    |
| `--host`          | `WEBUI_DEMO_HOST`          | `0.0.0.0` |
| `--concurrency`   | `WEBUI_DEMO_CONCURRENCY`   | `4`       |
| `--rate-limit`    | `WEBUI_DEMO_RATE_LIMIT`    | `0`       |

`--concurrency` bounds simultaneous startup and warmup work. A zero rate limit
disables gateway throttling so it cannot cap or distort RPS measurements.

## Tests

```
pnpm run test:todo:demo
```
