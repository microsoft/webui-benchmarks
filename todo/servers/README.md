# Todo benchmark runtime servers

Every official case runs exactly one server process with one worker. Product
SSR renderers that ship no canonical HTTP server (Vue, Preact, React, Solid,
and Lit) are served through the same minimal `node:http` transport
(`node-renderer.mjs`) so the matrix compares renderers, not web frameworks.

Each process exposes:

- `GET /dynamic` — rotates 32 immutable structural variants, captures a unique
  current UTC timestamp, materializes it into all 100 todos, and renders inside
  every request.
- `GET /cached` — reuses one complete response rendered at startup.
- `GET /__bench/ready` (or `/ready`) — machine-readable runtime, server,
  application, cache, response-size, state-count, and native-addon metadata.

HTML responses use `text/html; charset=utf-8`. Dynamic and metadata responses
use `Cache-Control: no-store`; cached HTML uses
`Cache-Control: public, max-age=31536000, immutable`. No server enables
compression.

Run from the repository root:

```text
node todo/servers/node-http.mjs --port 3001
node todo/servers/node-renderer.mjs --app react --port 3002
bun todo/servers/bun.mjs --port 3004
deno run --config todo/servers/deno.json --allow-env --allow-ffi \
  --allow-net --allow-read --allow-sys todo/servers/deno.mjs --port 3005
```

Set `WEBUI_ADDON_PATH` (or pass `--addon`) to force every JavaScript runtime to
the same native addon. A configured local WebUI checkout is preferred before
the released platform package when no path is supplied. Native-addon failure
exits with code 78 after emitting one JSON `unsupported` record; WebAssembly is
never used.

The official benchmark launches the `bun-serve` build, an ahead-of-time
`bun build --compile --bytecode --splitting --format=esm` executable
(`target/bun/webui-bun-serve`), instead of interpreting `bun.mjs` directly.
`--format=esm` is required because `--bytecode` defaults to a CommonJS target
that rejects the top-level `await` in `bun.mjs`'s startup block. Run
`node todo/runner/lib/builds.mjs` indirectly via the runner build plan (or
`bun build todo/servers/bun.mjs --compile --bytecode --splitting --format=esm
--outfile target/bun/webui-bun-serve`) to reproduce it locally.

`node todo/servers/verify-runtimes.mjs --official` enforces Node 24.19.0,
Bun 1.4.0, and Deno 2.9.6. Local verification reports an absent Deno as
`skipped`; official verification fails it. Generate the Rust state input with:

```text
node todo/servers/write-state-pool.mjs
cargo run --release --manifest-path todo/servers/rust-actix/Cargo.toml -- \
  --port 3006
node --test todo/servers/tests/*.test.mjs
```

The root Cargo workspace pins the released `microsoft-webui-handler` crate.
`pnpm run webui:configure` can instead patch it to a local WebUI checkout for
the current command without changing the manifest or lockfile.
