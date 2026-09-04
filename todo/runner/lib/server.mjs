// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { connect as connectHttp2 } from "node:http2";
import { resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import {
  loadFullStackMetadata,
  productionEntry,
} from "./metadata.mjs";
import { spawnManagedProcess } from "./process-tree.mjs";
import { BENCHMARK_ROOT, BUILD_ROOT, bunServeBinaryPath } from "./paths.mjs";
import { resolveRuntimeExecutable } from "../../servers/lib/runtime-executable.mjs";
import { resolveNativeAddon } from "../../servers/lib/webui-engine.mjs";

const SERVER_SCHEMA = "webui.ssr-todo-server/v1";
const OUTPUT_LIMIT = 64 * 1024;

function appendBounded(previous, chunk) {
  const combined = previous + chunk;
  return combined.length <= OUTPUT_LIMIT
    ? combined
    : combined.slice(-OUTPUT_LIMIT);
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve a TCP port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolvePort(port);
        }
      });
    });
  });
}

function launchRaw(command, args, { cwd, env, registry }) {
  const entry = spawnManagedProcess(command, args, {
    cwd,
    env,
    registry,
  });
  const { child } = entry;
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  return {
    child,
    entry,
    output() {
      return { stderr, stdout };
    },
  };
}

async function announcedServer(command, args, options) {
  const launched = launchRaw(command, args, options);
  const { child, entry } = launched;
  const lines = createInterface({ input: child.stdout });
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 60_000;
  let timer;
  let spawnError = null;
  child.once("error", (error) => {
    spawnError = error;
  });
  try {
    const announcement = await new Promise((resolveAnnouncement, reject) => {
      timer = setTimeout(() => {
        const output = launched.output();
        reject(
          new Error(
            `${command} did not announce readiness within ${timeoutMilliseconds}ms\n${output.stderr}`,
          ),
        );
      }, timeoutMilliseconds);
      lines.on("line", (line) => {
        try {
          const value = JSON.parse(line);
          if (
            value.status === "ready"
            || value.status === "unsupported"
            || value.status === "error"
          ) {
            resolveAnnouncement(value);
          }
        } catch {
          // Framework diagnostics may also be written to stdout.
        }
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        const output = launched.output();
        reject(
          new Error(
            `${command} exited with ${code ?? signal} before readiness\n${output.stderr || output.stdout}`,
          ),
        );
      });
    });
    return {
      announcement,
      child,
      command: [command, ...args].join(" "),
      output: launched.output,
      async stop() {
        lines.close();
        await options.registry.stop(entry);
      },
    };
  } catch (error) {
    lines.close();
    await options.registry.stop(entry);
    if (spawnError !== null) {
      throw new Error(`Failed to launch ${command}: ${spawnError.message}`, {
        cause: spawnError,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function requestHttp2Ok(
  url,
  { headers = {}, timeoutMilliseconds = 2_000 } = {},
) {
  return new Promise((resolveRequest, reject) => {
    const target = new URL(url);
    const session = connectHttp2(target.origin, {
      rejectUnauthorized: false,
    });
    const request = session.request({
      ...headers,
      ":path": `${target.pathname}${target.search}`,
    });
    let settled = false;
    let status;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error === undefined) {
        session.close();
        resolveRequest();
      } else {
        request.close();
        session.destroy();
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      finish(
        new Error(
          `HTTP/2 request timed out after ${timeoutMilliseconds}ms`,
        ),
      );
    }, timeoutMilliseconds);
    request.on("response", (headers) => {
      status = Number(headers[":status"]);
    });
    request.on("data", () => {});
    request.on("end", () => {
      if (status >= 200 && status < 300) {
        finish();
      } else {
        finish(new Error(`Readiness returned HTTP ${status}`));
      }
    });
    request.once("error", finish);
    session.once("error", finish);
    request.end();
  });
}

async function waitForHttp(url, launched, timeoutMilliseconds) {
  const deadline = performance.now() + timeoutMilliseconds;
  let lastError;
  while (performance.now() < deadline) {
    if (
      launched.child.exitCode !== null
      || launched.child.signalCode !== null
    ) {
      const output = launched.output();
      throw new Error(
        `Server exited before readiness\n${output.stderr || output.stdout}`,
      );
    }
    try {
      if (url.startsWith("https://")) {
        await requestHttp2Ok(
          url,
          {
            timeoutMilliseconds: Math.max(
              1,
              Math.min(2_000, Math.ceil(deadline - performance.now())),
            ),
          },
        );
        return;
      }
      const response = await fetch(url, {
        headers: { "accept-encoding": "identity" },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`Readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 100);
    });
  }
  const output = launched.output();
  throw new Error(
    `Server did not become ready at ${url}: ${lastError?.message ?? "timeout"}\n${output.stderr}`,
  );
}

const RESPONSE_BUFFER_PRELOAD = resolve(
  BENCHMARK_ROOT,
  "todo",
  "runner",
  "lib",
  "response-buffer-preload.cjs",
);

function withResponseModeEnv(env, responseMode, appId) {
  if (
    responseMode !== "complete"
    || (appId !== "next" && appId !== "astro")
  ) {
    return env;
  }
  // Full-stack production servers (Next.js, Astro) own their HTTP server
  // process end-to-end; there is no in-repo request handler to call
  // render()/renderStream() on directly the way the controlled renderer and
  // WebUI runtime tiers do. The complete suite instead loads a preload
  // module inside that *same* process (never an external proxy) that
  // buffers the framework's own Node http.ServerResponse writes and hands
  // the fully collected body to the socket in one piece. See
  // response-buffer-preload.cjs for the full rationale.
  const existingRequire = env.NODE_OPTIONS?.trim();
  const preload = RESPONSE_BUFFER_PRELOAD.replaceAll("\\", "/");
  return {
    ...env,
    NODE_OPTIONS: existingRequire
      ? `${existingRequire} --require "${preload}"`
      : `--require "${preload}"`,
    WEBUI_BENCH_RESPONSE_MODE: responseMode,
  };
}

async function fullStackServer(benchmarkCase, options) {
  const app = loadFullStackMetadata(benchmarkCase.appId);
  const browserTls = options.browserTls === true;
  const entryPath = browserTls
    ? resolve(
        BENCHMARK_ROOT,
        "todo",
        "browser",
        "fullstack-h2-server.mjs",
      )
    : productionEntry(app);
  if (!existsSync(entryPath)) {
    throw new Error(`Missing production server entry ${entryPath}`);
  }
  const port = await reservePort();
  const args = browserTls
    ? ["--app", benchmarkCase.appId, "--port", String(port)]
    : app.metadata.productionArgs.map((argument) =>
      argument.replace("{host}", "127.0.0.1").replace("{port}", String(port))
    );
  const responseMode = browserTls ? "progressive" : benchmarkCase.responseMode;
  const launched = launchRaw(process.execPath, [entryPath, ...args], {
    cwd: app.appRoot,
    env: withResponseModeEnv(
      {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: String(port),
        NODE_ENV: "production",
        PORT: String(port),
      },
      responseMode,
      benchmarkCase.appId,
    ),
    registry: options.registry,
  });
  const url = `${browserTls ? "https" : "http"}://127.0.0.1:${port}`;
  try {
    await waitForHttp(
      `${url}${app.metadata.routes.cached}`,
      launched,
      options.timeoutMilliseconds,
    );
  } catch (error) {
    await options.registry.stop(launched.entry);
    throw error;
  }
  const metadata = Object.freeze({
    addonCapability: Object.freeze({
      fallback: "not-applicable",
      kind: "framework-native",
      required: false,
      supported: true,
    }),
    appId: benchmarkCase.appId,
    cacheMode: "dynamic-and-cached",
    compression: false,
    responseMode,
    routes: app.metadata.routes,
    runtimeId: "node",
    runtimeVersion: process.versions.node,
    schema: SERVER_SCHEMA,
    serverId: benchmarkCase.serverId,
    stateVariantCount: 32,
    status: "ready",
    workerCount: app.metadata.workerCount,
  });
  return {
    announcement: Object.freeze({
      ...metadata,
      host: "127.0.0.1",
      port,
      url,
    }),
    child: launched.child,
    command: [process.execPath, entryPath, ...args].join(" "),
    output: launched.output,
    async stop() {
      await options.registry.stop(launched.entry);
    },
  };
}

function rustBinaryPath() {
  const extension = process.platform === "win32" ? ".exe" : "";
  return resolve(
    BUILD_ROOT,
    "release",
    `ssr-framework-bench-todo-actix${extension}`,
  );
}

function runtimeCommand(benchmarkCase) {
  const entry = resolve(
    BENCHMARK_ROOT,
    "todo",
    "servers",
    benchmarkCase.launcher.entry,
  );
  if (benchmarkCase.runtimeId === "node") {
    return {
      args: [entry, "--port", "0"],
      command: process.execPath,
    };
  }
  if (benchmarkCase.runtimeId === "bun") {
    return {
      args: ["--port", "0"],
      command: bunServeBinaryPath(),
    };
  }
  return {
    args: [
      "run",
      "--config",
      resolve(BENCHMARK_ROOT, "todo", "servers", "deno.json"),
      "--allow-env",
      "--allow-ffi",
      "--allow-net",
      "--allow-read",
      "--allow-sys",
      entry,
      "--port",
      "0",
    ],
    command: resolveRuntimeExecutable("deno"),
  };
}

export async function launchCaseServer(
  benchmarkCase,
  {
    browserAssetDirectory,
    browserTls = false,
    registry,
    timeoutMilliseconds = 60_000,
  },
) {
  if (benchmarkCase.launcher.kind === "full-stack") {
    return fullStackServer(benchmarkCase, {
      browserTls,
      registry,
      timeoutMilliseconds,
    });
  }
  if (benchmarkCase.launcher.kind === "renderer") {
    return announcedServer(
      process.execPath,
      [
        resolve(BENCHMARK_ROOT, "todo", "servers", "node-renderer.mjs"),
        "--app",
        benchmarkCase.appId,
        "--port",
        "0",
      ],
      {
        cwd: BENCHMARK_ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          WEBUI_BENCH_RESPONSE_MODE: benchmarkCase.responseMode,
        },
        registry,
        timeoutMilliseconds,
      },
    );
  }
  if (benchmarkCase.launcher.kind === "rust-actix") {
    const args = ["--port", "0"];
    if (browserTls) args.push("--tls");
    if (benchmarkCase.launcher.protocol !== undefined) {
      args.push(
        "--protocol",
        resolve(BENCHMARK_ROOT, benchmarkCase.launcher.protocol),
      );
    }
    if (benchmarkCase.launcher.plugin !== undefined) {
      args.push("--plugin", benchmarkCase.launcher.plugin);
    }
    if (!browserTls && benchmarkCase.responseMode !== undefined) {
      args.push("--response-mode", benchmarkCase.responseMode);
    }
    return announcedServer(
      rustBinaryPath(),
      args,
      {
        cwd: BENCHMARK_ROOT,
        env: {
          ...process.env,
          ...(browserAssetDirectory === undefined
            ? {}
            : { WEBUI_BROWSER_ASSET_DIRECTORY: browserAssetDirectory }),
        },
        registry,
        timeoutMilliseconds,
      },
    );
  }
  const runtime = runtimeCommand(benchmarkCase);
  const env = {
    ...process.env,
    NODE_ENV: "production",
    WEBUI_BENCH_RESPONSE_MODE: benchmarkCase.responseMode,
    ...(benchmarkCase.launcher.protocol === undefined
      ? {}
      : {
          WEBUI_BENCH_PROTOCOL: resolve(
            BENCHMARK_ROOT,
            benchmarkCase.launcher.protocol,
          ),
        }),
  };
  if (benchmarkCase.appId === "webui") {
    env.WEBUI_ADDON_PATH = (await resolveNativeAddon()).path;
  }
  return announcedServer(runtime.command, runtime.args, {
    cwd: BENCHMARK_ROOT,
    env,
    registry,
    timeoutMilliseconds,
  });
}

export function assertServerMetadata(benchmarkCase, metadata) {
  if (metadata.status !== "ready") {
    throw new Error(
      `${benchmarkCase.id} reported ${metadata.status}: ${metadata.message ?? metadata.code ?? "unknown"}`,
    );
  }
  for (const [name, expected] of [
    ["schema", SERVER_SCHEMA],
    ["appId", benchmarkCase.appId],
    ["runtimeId", benchmarkCase.runtimeId],
    ["serverId", benchmarkCase.serverId],
  ]) {
    if (metadata[name] !== expected) {
      throw new Error(
        `${benchmarkCase.id} metadata ${name} expected ${expected}, received ${metadata[name]}`,
      );
    }
  }
  if (
    benchmarkCase.responseMode !== undefined
    && metadata.responseMode !== undefined
    && metadata.responseMode !== benchmarkCase.responseMode
  ) {
    throw new Error(
      `${benchmarkCase.id} launched in response mode '${metadata.responseMode}', expected '${benchmarkCase.responseMode}'`,
    );
  }
  if (metadata.workerCount !== 1) {
    throw new Error(`${benchmarkCase.id} must run exactly one server worker`);
  }
  if (metadata.stateVariantCount !== 32) {
    throw new Error(`${benchmarkCase.id} must expose all 32 state variants`);
  }
  const isNativeAddonCase = benchmarkCase.launcher?.kind === "webui-runtime";
  if (
    isNativeAddonCase
    && (
      metadata.addonCapability?.supported !== true
      || metadata.addonCapability?.fallback !== "disabled"
      || metadata.addonCapability?.kind !== "node-api-native"
    )
  ) {
    throw new Error(
      `${benchmarkCase.id} must load the native Node-API addon without fallback`,
    );
  }
  return metadata;
}

export { reservePort, SERVER_SCHEMA };
