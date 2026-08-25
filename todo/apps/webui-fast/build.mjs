// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildProtocol } from "@microsoft/webui";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../../servers/lib/cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "src");
const outputPath = resolve(here, "dist");
const generatedSourcePath = resolve(outputPath, "src");
const protocolPath = resolve(outputPath, "protocol.bin");
const linkedStylesPath = resolve(outputPath, "browser", "fast");

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
    rm(generatedSourcePath, { force: true, recursive: true }),
    mkdir(outputPath, { recursive: true }),
  ]).then(async () => {
    await cp(sourcePath, generatedSourcePath, { recursive: true });
    const result = buildProtocol({
      appDir: generatedSourcePath,
      css: "link",
      cssPublicBase: "/__browser/fast",
      dom: "shadow",
      entry: "index.html",
      plugin: "fast-v3",
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
