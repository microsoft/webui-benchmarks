// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildProtocol } from "@microsoft/webui";
import { esbuildProjection } from "@microsoft/webui/projection.js";
import { build as buildBundle } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "src");
const outputPath = resolve(here, "dist");
const generatedSourcePath = resolve(outputPath, "src");
const projectionBundlePath = resolve(outputPath, "projection-client.js");
const projectionManifestPath = resolve(outputPath, "webui-projection.json");
const protocolPath = resolve(outputPath, "protocol.bin");
const linkedStylesPath = resolve(outputPath, "browser", "light");
const stylesPath = resolve(here, "..", "..", "shared", "styles.css");
let buildPromise;

async function writeCssFiles(cssFiles) {
  await rm(linkedStylesPath, { force: true, recursive: true });
  await mkdir(linkedStylesPath, { recursive: true });
  for (let index = 0; index < cssFiles.length; index += 2) {
    await writeFile(
      resolve(linkedStylesPath, cssFiles[index]),
      cssFiles[index + 1],
      "utf8",
    );
  }
}

export function build() {
  buildPromise ??= Promise.all([
    readFile(stylesPath, "utf8"),
    rm(generatedSourcePath, { force: true, recursive: true }),
    mkdir(outputPath, { recursive: true }),
  ]).then(async ([css]) => {
    await cp(sourcePath, generatedSourcePath, { recursive: true });
    await writeFile(
      resolve(generatedSourcePath, "todo-app", "todo-app.css"),
      css,
      "utf8",
    );
    await buildBundle({
      absWorkingDir: here,
      banner: {
        js: "// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT license.",
      },
      bundle: true,
      define: {
        __WEBUI_DEV__: "false",
      },
      entryPoints: ["component-definitions.ts"],
      format: "esm",
      legalComments: "none",
      minify: true,
      outfile: projectionBundlePath,
      platform: "browser",
      plugins: [
        esbuildProjection({ manifest: projectionManifestPath }),
      ],
      target: "chrome120",
    });
    const result = buildProtocol({
      appDir: generatedSourcePath,
      css: "link",
      cssPublicBase: "/__browser/light",
      dom: "light",
      entry: "index.html",
      plugin: "webui",
      projectionManifests: [projectionManifestPath],
    });
    await Promise.all([
      writeFile(protocolPath, result.protocol),
      writeCssFiles(result.cssFiles),
    ]);
    return {
      css,
      cssFiles: result.cssFiles,
      projectionManifestPath,
      protocol: result.protocol,
      protocolPath,
    };
  });
  return buildPromise;
}
