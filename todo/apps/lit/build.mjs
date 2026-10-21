// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildBundle } from "esbuild";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(here, "dist");
const serverArtifactPath = resolve(outputDirectory, "server.mjs");
const clientArtifactPath = resolve(outputDirectory, "client.mjs");
const componentsArtifactPath = resolve(outputDirectory, "components.mjs");
const stylesPath = resolve(here, "..", "..", "shared", "styles.css");
const banner = {
  js: "// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT license.",
};
// The component stylesheets are authored as real `.css` files and pulled in
// with `with { type: "text" }`, so the shared sheet stays the single source of
// truth instead of being duplicated into template literals.
const loader = { ".css": "text" };
const litExternals = ["lit", "lit/*", "@lit-labs/*", "@lit/*"];

let buildPromise;

function buildServer() {
  return buildBundle({
    banner,
    bundle: true,
    entryPoints: [resolve(here, "server.mjs")],
    external: litExternals,
    format: "esm",
    legalComments: "none",
    loader,
    minify: true,
    outfile: serverArtifactPath,
    platform: "node",
    target: "node26",
  });
}

function buildBrowser() {
  return buildBundle({
    banner,
    bundle: true,
    chunkNames: "client-chunks/[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
    entryNames: "client",
    entryPoints: [resolve(here, "client.mjs")],
    format: "esm",
    legalComments: "none",
    loader,
    minify: true,
    outdir: outputDirectory,
    outExtension: { ".js": ".mjs" },
    platform: "browser",
    splitting: true,
    target: "chrome120",
  });
}

// Client-mode components with `lit` left external, so any host bundler - the
// browser runner, or a test - can consume the very same compiled sources.
function buildComponents() {
  return buildBundle({
    banner,
    bundle: true,
    chunkNames: "component-chunks/[name]-[hash]",
    entryNames: "components",
    entryPoints: [resolve(here, "client.mjs")],
    external: litExternals,
    format: "esm",
    legalComments: "none",
    loader,
    outdir: outputDirectory,
    outExtension: { ".js": ".mjs" },
    platform: "neutral",
    splitting: true,
    target: "es2022",
  });
}

export function build() {
  buildPromise ??= Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    readFile(stylesPath, "utf8"),
  ]).then(async ([, css]) => {
    await Promise.all([
      rm(resolve(outputDirectory, "client-chunks"), {
        force: true,
        recursive: true,
      }),
      rm(resolve(outputDirectory, "component-chunks"), {
        force: true,
        recursive: true,
      }),
    ]);
    await Promise.all([buildServer(), buildBrowser(), buildComponents()]);
    return {
      artifactPath: serverArtifactPath,
      clientArtifactPath,
      componentsArtifactPath,
      css,
    };
  });
  return buildPromise;
}
