// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildBundle } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const ENTRY_EXTENSIONS = Object.freeze({
  preact: "mjs",
  react: "mjs",
  solid: "jsx",
  vue: "mjs",
  webui: "mjs",
  "webui-fast": "mjs",
});

function isWebUiClient(appId) {
  return appId === "webui" || appId === "webui-fast";
}

function buildOptions(appId) {
  const extension = ENTRY_EXTENSIONS[appId];
  if (extension === undefined) {
    throw new RangeError(`No controlled browser client for '${appId}'`);
  }

  return {
    banner: {
      js: "// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT license.",
    },
    bundle: true,
    define: {
      __WEBUI_DEV__: "false",
      "process.env.NODE_ENV": '"production"',
    },
    entryPoints: [resolve(here, "client", `${appId}.${extension}`)],
    external: isWebUiClient(appId)
      ? ["/__browser/webui-components.js"]
      : [],
    format: "esm",
    ...(appId === "react" || appId === "preact"
      ? { jsx: "automatic", jsxImportSource: appId }
      : {}),
    legalComments: "none",
    minify: true,
    outfile: `${appId}.js`,
    platform: "browser",
    plugins: [
      ...(appId === "solid"
        ? [solidPlugin({ solid: { generate: "dom", hydratable: true } })]
        : []),
    ],
    sourcemap: false,
    target: "chrome120",
    write: false,
  };
}

async function collectCssAssets(root) {
  const assets = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && extname(entry.name) === ".css") {
        const assetPath = relative(root, path).replaceAll("\\", "/");
        assets.push([`/__browser/${assetPath}`, await readFile(path)]);
      }
    }
  }
  return assets;
}

async function buildClient(appId) {
  const result = await buildBundle(buildOptions(appId));
  const javascript = result.outputFiles.find(
    ({ path }) => [".js", ".mjs"].includes(extname(path)),
  );
  if (javascript === undefined) {
    throw new Error(`${appId} browser build did not emit JavaScript`);
  }
  const bundle = Buffer.from(javascript.contents);
  if (isWebUiClient(appId)) {
    const components = await buildBundle({
      ...buildOptions(appId),
      entryPoints: [
        resolve(here, "..", "apps", appId, "component-definitions.ts"),
      ],
      external: [],
      outfile: "webui-components.js",
    });
    const componentJavascript = components.outputFiles.find(
      ({ path }) => [".js", ".mjs"].includes(extname(path)),
    );
    if (componentJavascript === undefined) {
      throw new Error(`${appId} component build did not emit JavaScript`);
    }
    const browserAssetDirectory = resolve(
      here,
      "..",
      "apps",
      appId,
      "dist",
      "browser",
    );
    const cssAssets = await collectCssAssets(browserAssetDirectory);
    bundle.additionalAssets = new Map([
      [
        "/__browser/webui-components.js",
        Buffer.from(componentJavascript.contents),
      ],
      ...cssAssets,
    ]);
    await mkdir(browserAssetDirectory, { recursive: true });
    await Promise.all([
      writeFile(resolve(browserAssetDirectory, "webui.js"), bundle),
      writeFile(
        resolve(browserAssetDirectory, "webui-components.js"),
        componentJavascript.contents,
      ),
    ]);
    bundle.browserAssetDirectory = browserAssetDirectory;
  }
  return bundle;
}

export async function buildSolidBrowserRenderer() {
  const { build, buildBrowser } = await import(
    "../apps/solid/build.mjs"
  );
  const [{ artifactPath }, { artifactPath: browserArtifactPath }] =
    await Promise.all([build(), buildBrowser()]);
  const module = await import(pathToFileURL(artifactPath).href);
  if (
    typeof module.renderTodo !== "function"
    || typeof module.renderHydrationScript !== "function"
  ) {
    throw new Error(
      "Solid browser SSR build did not export its renderer and hydration script",
    );
  }
  return Object.freeze({
    bootstrap: module.renderHydrationScript(),
    bundleBytes: (await readFile(browserArtifactPath)).byteLength,
    render: module.renderTodo,
  });
}

async function buildControlledServerRenderer(appId) {
  const builder = await import(`../apps/${appId}/build.mjs`);
  const { artifactPath } = await builder.build();
  const module = await import(pathToFileURL(artifactPath).href);
  if (typeof module.renderTodo !== "function") {
    throw new Error(`${appId} browser SSR build did not export renderTodo`);
  }
  return Object.freeze({
    bundleBytes: (await readFile(artifactPath)).byteLength,
    render: module.renderTodo,
  });
}

export async function buildControlledClients(browserCases) {
  const bundles = new Map();
  const failures = new Map();
  const serverRenderers = new Map();
  for (const { appId, controlled } of browserCases) {
    if (!controlled) {
      continue;
    }
    try {
      bundles.set(appId, await buildClient(appId));
    } catch (error) {
      failures.set(
        appId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const rendererApps = new Set(
    browserCases
      .filter(
        ({ appId, browserOutcome, controlled }) =>
          controlled
          && browserOutcome.status === "supported"
          && ["preact", "react", "solid", "vue"].includes(appId),
      )
      .map(({ appId }) => appId),
  );
  for (const appId of rendererApps) {
    try {
      serverRenderers.set(
        appId,
        appId === "solid"
          ? await buildSolidBrowserRenderer()
          : await buildControlledServerRenderer(appId),
      );
    } catch (error) {
      failures.set(
        appId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return Object.freeze({ bundles, failures, serverRenderers });
}

export { buildClient };
