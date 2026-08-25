// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  BENCHMARK_ROOT,
  BUILD_ROOT,
} from "../runner/lib/paths.mjs";

const execFileAsync = promisify(execFile);
const outputDirectory = resolve(
  BUILD_ROOT,
  "ssr-framework-bench-tls",
);
let materialPromise;

function generatorPath() {
  const extension = process.platform === "win32" ? ".exe" : "";
  return resolve(
    BUILD_ROOT,
    "release",
    `tls_material${extension}`,
  );
}

export function browserTlsMaterial() {
  materialPromise ??= mkdir(outputDirectory, { recursive: true }).then(
    async () => {
      await execFileAsync(
        generatorPath(),
        ["--out", outputDirectory],
        {
          cwd: BENCHMARK_ROOT,
          windowsHide: true,
        },
      );
      const certPath = resolve(outputDirectory, "cert.pem");
      const keyPath = resolve(outputDirectory, "key.pem");
      const [cert, key] = await Promise.all([
        readFile(certPath),
        readFile(keyPath),
      ]);
      return Object.freeze({
        cert,
        certPath,
        key,
        keyPath,
      });
    },
  );
  return materialPromise;
}
