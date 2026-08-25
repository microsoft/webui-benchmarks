// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildProtocol } from "@microsoft/webui";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as buildLightDom } from "../webui/build.mjs";
import { isMainModule } from "../../servers/lib/cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, "dist");
const generatedSourcePath = resolve(outputPath, "src");
const protocolPath = resolve(outputPath, "protocol.bin");
const lightAppPath = resolve(here, "..", "webui");
const linkedStylesPath = resolve(
  lightAppPath,
  "dist",
  "browser",
  "shadow",
);
const stylesPath = resolve(here, "styles");

const COMPONENTS = Object.freeze([
  "todo-app",
  "todo-badge",
  "todo-button",
  "todo-checkbox",
  "todo-filter",
  "todo-footer",
  "todo-header",
  "todo-item",
  "todo-list",
  "todo-summary",
  "todo-tag-list",
  "todo-toolbar",
]);

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
  buildPromise ??= buildLightDom().then(async ({ projectionManifestPath }) => {
    await rm(generatedSourcePath, { force: true, recursive: true });
    await mkdir(outputPath, { recursive: true });
    await cp(
      resolve(lightAppPath, "dist", "src"),
      generatedSourcePath,
      { recursive: true },
    );
    await Promise.all(
      COMPONENTS.map(async (component) => {
        const target = resolve(
          generatedSourcePath,
          component,
          `${component}.css`,
        );
        await rm(target, { force: true });
        const css = await readFile(
          resolve(stylesPath, `${component}.css`),
          "utf8",
        );
        await writeFile(target, css, "utf8");
      }),
    );
    const result = buildProtocol({
      appDir: generatedSourcePath,
      css: "link",
      cssPublicBase: "/__browser/shadow",
      dom: "shadow",
      entry: "index.html",
      plugin: "webui",
      projectionManifests: [projectionManifestPath],
    });
    await Promise.all([
      writeFile(protocolPath, result.protocol),
      writeCssFiles(result.cssFiles),
    ]);
    return {
      cssFiles: result.cssFiles,
      protocol: result.protocol,
      protocolPath,
    };
  });
  return buildPromise;
}

if (isMainModule(import.meta.url)) {
  await build();
}
