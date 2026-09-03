// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  createDemoHandler,
  createRateLimiter,
  rewriteLocation,
  startDemoGateway,
} from "../gateway.mjs";
import { createDemoRegistry } from "../registry.mjs";
import { DEMO_COOKIE } from "../routing.mjs";

const products = createDemoRegistry();
const product = products[0];

function startUpstream() {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/dynamic" });
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "set-cookie": "upstream=1",
    });
    response.end(`upstream ${request.url} ${request.headers["x-forwarded-proto"]}`);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        close: () => new Promise((closed) => server.close(closed)),
        origin: `http://127.0.0.1:${server.address().port}`,
      })
    );
  });
}

async function withGateway(operation, handlerOptions = {}) {
  const upstream = await startUpstream();
  const hosted = new Map(
    products.map((entry) => [
      entry.id,
      { assets: new Map(), origin: upstream.origin, product: entry },
    ]),
  );
  const gateway = await startDemoGateway({
    handler: createDemoHandler({ hosted, products, ...handlerOptions }),
    host: "127.0.0.1",
    port: 0,
    trustProxyHeaders: handlerOptions.trustProxyHeaders,
  });
  try {
    await operation(`http://127.0.0.1:${gateway.port}`);
  } finally {
    await gateway.close();
    await upstream.close();
  }
}

test("the gallery lists every hosted product entry point", async () => {
  await withGateway(async (origin) => {
    const response = await fetch(origin);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    for (const entry of products) {
      assert.ok(
        body.includes(`href="${entry.launchPath}/dynamic"`),
        `${entry.id} is missing from the gallery`,
      );
    }
  });
});

test("a benchmark path responds directly without redirects or cookies", async () => {
  await withGateway(async (origin) => {
    const benchmark = await fetch(`${origin}${product.benchmarkPath}/dynamic`, {
      redirect: "manual",
    });
    assert.equal(benchmark.status, 200);
    assert.equal(benchmark.headers.get("location"), null);
    assert.equal(benchmark.headers.get("set-cookie"), null);
    assert.equal(await benchmark.text(), "upstream /dynamic http");
  });
});

test("launching an app pins it and hands it the origin root", async () => {
  await withGateway(async (origin) => {
    const launch = await fetch(`${origin}${product.launchPath}/dynamic`, {
      redirect: "manual",
    });
    assert.equal(launch.status, 302);
    assert.equal(launch.headers.get("location"), "/dynamic");
    const cookie = launch.headers.get("set-cookie");
    assert.match(cookie, new RegExp(`^${DEMO_COOKIE}=${product.id};`, "u"));
    assert.match(cookie, /HttpOnly/u);
    assert.match(cookie, /SameSite=Lax/u);

    const proxied = await fetch(`${origin}/dynamic`, {
      headers: { cookie: `${DEMO_COOKIE}=${product.id}` },
    });
    assert.equal(await proxied.text(), "upstream /dynamic http");
    assert.equal(proxied.headers.get("set-cookie"), null);
  });
});

test("untrusted forwarded protocol headers cannot make requests secure", async () => {
  await withGateway(async (origin) => {
    const headers = { "x-forwarded-proto": "https" };
    const launch = await fetch(`${origin}${product.launchPath}/dynamic`, {
      headers,
      redirect: "manual",
    });
    assert.doesNotMatch(launch.headers.get("set-cookie"), /Secure/u);
    assert.equal(launch.headers.get("strict-transport-security"), null);

    const proxied = await fetch(`${origin}/dynamic`, {
      headers: { ...headers, cookie: `${DEMO_COOKIE}=${product.id}` },
    });
    assert.equal(await proxied.text(), "upstream /dynamic http");
  });
});

test("unpinned, unknown, and unsafe requests are refused", async () => {
  await withGateway(async (origin) => {
    assert.equal((await fetch(`${origin}/dynamic`)).status, 404);
    assert.equal((await fetch(`${origin}/app/unknown/dynamic`)).status, 404);
    const posted = await fetch(`${origin}/dynamic`, { method: "POST" });
    assert.equal(posted.status, 405);
    assert.equal(posted.headers.get("allow"), "GET, HEAD");
  });
});

test("readiness waits until every product is hosted", async () => {
  const gateway = await startDemoGateway({
    handler: createDemoHandler({ hosted: new Map(), products }),
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const origin = `http://127.0.0.1:${gateway.port}`;
    const health = await fetch(`${origin}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).products, products.length);
    const ready = await fetch(`${origin}/readyz`);
    assert.equal(ready.status, 503);
    const readiness = await ready.json();
    assert.equal(readiness.hosted, 0);
    assert.equal(readiness.products, products.length);
    assert.equal(readiness.starting, 0);
    assert.equal(readiness.status, "starting");
    assert.ok(readiness.uptimeSeconds >= 0);
  } finally {
    await gateway.close();
  }
});

test("benchmark requests start an unhosted product before proxying", async () => {
  const upstream = await startUpstream();
  const hosted = new Map();
  let launches = 0;
  const gateway = await startDemoGateway({
    handler: createDemoHandler({
      ensureHosted: async (entry) => {
        launches += 1;
        const hostedEntry = {
          assets: new Map(),
          origin: upstream.origin,
          product: entry,
        };
        hosted.set(entry.id, hostedEntry);
        return hostedEntry;
      },
      hosted,
      products,
    }),
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const origin = `http://127.0.0.1:${gateway.port}`;
    const launch = await fetch(`${origin}${product.benchmarkPath}/dynamic`, {
      redirect: "manual",
    });
    assert.equal(launch.status, 200);
    assert.equal(launch.headers.get("location"), null);
    assert.equal(await launch.text(), "upstream /dynamic http");
    assert.equal(launches, 1);
    assert.ok(hosted.has(product.id));
  } finally {
    await gateway.close();
    await upstream.close();
  }
});

test("the rate limiter bounds one client without blocking another", () => {
  let clock = 0;
  const admit = createRateLimiter({
    limit: 2,
    now: () => clock,
    windowMilliseconds: 1_000,
  });
  assert.equal(admit("a"), true);
  assert.equal(admit("a"), true);
  assert.equal(admit("a"), false);
  assert.equal(admit("b"), true);
  clock = 1_001;
  assert.equal(admit("a"), true);
});

test("upstream redirects can never leave the demo origin", () => {
  const upstream = "http://127.0.0.1:41234";
  assert.equal(rewriteLocation("/activity", upstream), "/activity");
  assert.equal(rewriteLocation(`${upstream}/activity?a=1`, upstream), "/activity?a=1");
  assert.equal(rewriteLocation("//evil.example/x", upstream), "/");
  assert.equal(rewriteLocation("https://evil.example/x", upstream), "/");
});
