// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildBundle } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(here, "dist");
const artifactPath = resolve(outputDirectory, "server.mjs");
const browserArtifactPath = resolve(outputDirectory, "browser.js");
const stylesPath = resolve(here, "..", "..", "shared", "styles.css");
const banner = {
  js: "// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT license.",
};
let buildPromise;
let browserPromise;

export function build() {
  buildPromise ??= Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    readFile(stylesPath, "utf8"),
  ]).then(async ([, css]) => {
    await buildBundle({
      banner,
      bundle: true,
      entryPoints: [resolve(here, "server.jsx")],
      external: [
        "@solidjs/router",
        "@solidjs/router/*",
        "solid-js",
        "solid-js/web",
      ],
      format: "esm",
      legalComments: "none",
      minify: true,
      outfile: artifactPath,
      platform: "node",
      plugins: [
        solidPlugin({ solid: { generate: "ssr", hydratable: true } }),
      ],
      target: "node24",
    });
    return { artifactPath, css };
  });
  return buildPromise;
}

/** Builds the app-owned browser entry that hydrates the authored Solid source. */
export function buildBrowser() {
  browserPromise ??= mkdir(outputDirectory, { recursive: true }).then(
    async () => {
      await buildBundle({
        banner,
        bundle: true,
        entryPoints: [resolve(here, "browser.jsx")],
        format: "esm",
        legalComments: "none",
        minify: true,
        outfile: browserArtifactPath,
        platform: "browser",
        plugins: [
          solidPlugin({ solid: { generate: "dom", hydratable: true } }),
        ],
        target: "es2022",
      });
      return { artifactPath: browserArtifactPath };
    },
  );
  return browserPromise;
}
