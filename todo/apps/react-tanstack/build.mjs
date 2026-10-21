// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildBundle } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(here, "dist");
const artifactPath = resolve(outputDirectory, "server.mjs");
const stylesPath = resolve(here, "..", "..", "shared", "styles.css");
let buildPromise;

export function build() {
  buildPromise ??= Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    readFile(stylesPath, "utf8"),
  ]).then(async ([, css]) => {
    await buildBundle({
      banner: {
        js: [
          "// Copyright (c) Microsoft Corporation.",
          "// Licensed under the MIT license.",
          'import { createRequire } from "node:module";',
          "const require = createRequire(import.meta.url);",
        ].join("\n"),
      },
      bundle: true,
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      entryPoints: [resolve(here, "server.jsx")],
      format: "esm",
      jsx: "automatic",
      jsxImportSource: "react",
      legalComments: "none",
      minify: true,
      outfile: artifactPath,
      platform: "node",
      target: "node26",
    });
    return { artifactPath, css };
  });
  return buildPromise;
}
