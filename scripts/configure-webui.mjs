// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(repositoryRoot, ".webui-local.json");
const cachePath = resolve(repositoryRoot, ".cache", "webui-checkout");

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function validateCheckout(candidate) {
  const checkout = realpathSync(candidate);
  for (const path of [
    resolve(checkout, "Cargo.toml"),
    resolve(checkout, "packages", "webui", "package.json"),
    resolve(checkout, "packages", "webui-framework", "package.json"),
    resolve(checkout, "crates", "webui-handler", "Cargo.toml"),
  ]) {
    if (!existsSync(path)) {
      throw new Error(`WebUI checkout is missing ${path}`);
    }
  }
  return checkout;
}

function checkoutRef(ref) {
  mkdirSync(dirname(cachePath), { recursive: true });
  if (!existsSync(resolve(cachePath, ".git"))) {
    run(
      "git",
      [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        "https://github.com/microsoft/webui.git",
        cachePath,
      ],
    );
  }
  run("git", ["fetch", "--depth", "1", "origin", ref], cachePath);
  run("git", ["checkout", "--detach", "--force", "FETCH_HEAD"], cachePath);
  return validateCheckout(cachePath);
}

function main(argv) {
  if (argv.includes("--release")) {
    rmSync(configPath, { force: true });
    process.stdout.write(
      "Configured released WebUI packages. Run pnpm install --force --frozen-lockfile.\n",
    );
    return;
  }
  const path = option(argv, "--path");
  const ref = option(argv, "--ref");
  if ((path === undefined) === (ref === undefined)) {
    throw new Error(
      "Specify exactly one of --path <checkout> or --ref <git-ref>",
    );
  }
  const checkout = path === undefined
    ? checkoutRef(ref)
    : validateCheckout(resolve(repositoryRoot, path));
  const relativeCheckout = relative(repositoryRoot, checkout)
    .replaceAll("\\", "/");
  writeFileSync(
    configPath,
    `${JSON.stringify({
      checkout: relativeCheckout,
      requestedRef: ref ?? null,
    }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `Configured WebUI checkout ${checkout}. Run pnpm install --force --no-frozen-lockfile --lockfile=false.\n`,
  );
}

main(process.argv.slice(2));
