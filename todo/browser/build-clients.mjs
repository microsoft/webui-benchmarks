// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildBundle } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const ENTRY_EXTENSIONS = Object.freeze({
  preact: "mjs",
  react: "mjs",
  "react-tanstack": "mjs",
  solid: "jsx",
  vue: "mjs",
  webui: "mjs",
  "webui-fast": "mjs",
});

function isWebUiClient(appId) {
  return appId === "webui" || appId === "webui-fast";
}

function packageContributionBytes(metafile, packageName) {
  const marker = `/node_modules/${packageName}/`;
  let bytes = 0;
  for (const output of Object.values(metafile.outputs)) {
    for (const [inputPath, contribution] of Object.entries(output.inputs)) {
      const normalizedPath = `/${inputPath.replaceAll("\\", "/")}`;
      if (normalizedPath.includes(marker)) {
        bytes += contribution.bytesInOutput;
      }
    }
  }
  return bytes;
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
    external: [],
    format: "esm",
    ...(appId === "react" || appId === "react-tanstack" || appId === "preact"
      ? {
          jsx: "automatic",
          jsxImportSource: appId === "preact" ? "preact" : "react",
        }
      : {}),
    legalComments: "none",
    metafile: true,
    minify: true,
    chunkNames: "chunks/[name]-[hash]",
    entryNames: appId,
    outdir: resolve(here, ".browser-build", appId),
    platform: "browser",
    plugins: [
      ...(appId === "solid"
        ? [solidPlugin({ solid: { generate: "dom", hydratable: true } })]
        : []),
    ],
    sourcemap: false,
    splitting: true,
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
  if (appId === "vue") {
    const { build } = await import("../apps/vue/build.mjs");
    await build();
  }
  const options = buildOptions(appId);
  const result = await buildBundle(options);
  const javascript = result.outputFiles.find(
    ({ path }) => basename(path) === `${appId}.js`,
  );
  if (javascript === undefined) {
    throw new Error(`${appId} browser build did not emit JavaScript`);
  }
  const bundle = Buffer.from(javascript.contents);
  const outputRoot = options.outdir;
  const chunkAssets = result.outputFiles
    .filter(
      ({ path }) =>
        path !== javascript.path
        && [".js", ".mjs"].includes(extname(path)),
    )
    .map(({ contents, path }) => [
      `/__browser/${
        relative(outputRoot, path).replaceAll("\\", "/")
      }`,
      Buffer.from(contents),
    ]);
  bundle.additionalAssets = new Map(chunkAssets);
  bundle.totalJavaScriptBytes = result.outputFiles
    .filter(({ path }) => [".js", ".mjs"].includes(extname(path)))
    .reduce((total, { contents }) => total + contents.byteLength, 0);
  bundle.featureAssets = Object.freeze(
    Object.fromEntries(
      [
        "analytics",
        "csv",
        "saved-view",
        "schedule",
        "search",
      ].map((feature) => {
        const suffix = `/workspace-${feature}.mjs`;
        const output = Object.entries(result.metafile.outputs).find(
          ([, metadata]) =>
            Object.keys(metadata.inputs).some((inputPath) =>
              `/${inputPath.replaceAll("\\", "/")}`.endsWith(suffix)
              || basename(inputPath).startsWith(`workspace-${feature}-`)
            ),
        );
        bundle.routeAssets = Object.freeze(
            Object.fromEntries(
              ["activity-page", "settings-page"].map((route) => {
                const output = Object.entries(result.metafile.outputs).find(
                  ([, metadata]) =>
                    Object.keys(metadata.inputs).some((inputPath) =>
                      basename(inputPath).startsWith(`${route}-`)
                      || [".js", ".jsx", ".mjs", ".ts"].some((extension) =>
                        `/${inputPath.replaceAll("\\", "/")}`.endsWith(
                          `/${route}${extension}`,
                        )
                      )
                    ),
                );
                if (output === undefined) return [route, null];
                return [
                  route,
                  `/__browser/${
                    relative(outputRoot, resolve(output[0])).replaceAll("\\", "/")
                  }`,
                ];
              }),
            ),
        );
        if (output === undefined) return [feature, null];
        return [
          feature,
          `/__browser/${
            relative(outputRoot, resolve(output[0])).replaceAll("\\", "/")
          }`,
        ];
      }),
    ),
  );
  bundle.packageBytes = Object.freeze(
    Object.fromEntries(
      [
        "@tanstack/react-router",
        "@tanstack/table-core",
        "preact",
        "react",
        "react-dom",
        "solid-js",
        "svelte",
        "vue",
        "zod",
      ].map((packageName) => [
        packageName,
        packageContributionBytes(result.metafile, packageName),
      ]),
    ),
  );
  if (isWebUiClient(appId)) {
    const appDirectory = appId === "webui" ? "webui-lightdom" : appId;
    const browserAssetDirectory = resolve(
      here,
      "..",
      "apps",
      appDirectory,
      "dist",
      "browser",
    );
    await mkdir(browserAssetDirectory, { recursive: true });
    const cssAssets = await collectCssAssets(browserAssetDirectory);
    bundle.additionalAssets = new Map([
      ...chunkAssets,
      ...cssAssets,
    ]);
    await Promise.all([
      rm(resolve(browserAssetDirectory, "chunks"), {
        force: true,
        recursive: true,
      }),
      rm(resolve(browserAssetDirectory, "webui-components.js"), {
        force: true,
      }),
    ]);
    await Promise.all([
      writeFile(resolve(browserAssetDirectory, "webui.js"), bundle),
      ...chunkAssets.map(async ([assetPath, contents]) => {
        const destination = resolve(
          browserAssetDirectory,
          assetPath.replace(/^\/__browser\//u, ""),
        );
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, contents);
      }),
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
    renderStream: module.renderTodoStream,
    ownsDocument: module.ownsDocument === true,
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
    renderStream: module.renderTodoStream,
    ownsDocument: module.ownsDocument === true,
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
          && [
            "preact",
            "react",
            "react-tanstack",
            "solid",
            "vue",
          ].includes(appId),
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
