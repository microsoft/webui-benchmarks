// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { arch, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(repositoryRoot, ".webui-local.json");
const checkoutCacheKey = createHash("sha256")
  .update(repositoryRoot)
  .digest("hex")
  .slice(0, 16);
const checkoutCacheRoot = resolve(
  tmpdir(),
  "webui-benchmarks",
  checkoutCacheKey,
);
const packageCachePath = resolve(repositoryRoot, ".cache", "webui-pack");
const publicRegistry = "--registry=https://registry.npmjs.org";
const packageDirectories = Object.freeze({
  "@microsoft/webui": "webui",
  "@microsoft/webui-framework": "webui-framework",
  "@microsoft/webui-delivery": "webui-delivery",
});
const packedArchiveNames = Object.freeze({
  "@microsoft/webui": "webui-local.tgz",
  "@microsoft/webui-framework": "webui-framework-local.tgz",
  "@microsoft/webui-delivery": "webui-delivery-local.tgz",
});

function resolvePnpmInvocation() {
  if (
    process.env.npm_execpath !== undefined
    && existsSync(process.env.npm_execpath)
  ) {
    return {
      args: [process.env.npm_execpath],
      command: process.execPath,
    };
  }
  if (process.platform === "win32") {
    const result = spawnSync("where.exe", ["pnpm.exe"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const executable = result.status === 0
      ? result.stdout.split(/\r?\n/u).find((path) => path && existsSync(path))
      : undefined;
    if (executable === undefined) {
      throw new Error("pnpm.exe was not found; invoke this command through pnpm");
    }
    return { args: [], command: executable };
  }
  return { args: [], command: "pnpm" };
}

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

const pnpmInvocation = resolvePnpmInvocation();

function runPnpm(args, cwd = repositoryRoot) {
  run(
    pnpmInvocation.command,
    [...pnpmInvocation.args, ...args],
    cwd,
  );
}

function gitValue(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function workingTreeHash(checkout, status) {
  const diff = gitValue(["diff", "--binary", "HEAD"], checkout);
  const untracked = gitValue(
    ["ls-files", "--others", "--exclude-standard"],
    checkout,
  );
  if (diff === null || untracked === null) {
    throw new Error("Failed to fingerprint the WebUI working tree");
  }
  const hash = createHash("sha256").update(status).update(diff);
  for (const path of untracked.split("\n").filter(Boolean)) {
    hash.update(path).update(readFileSync(resolve(checkout, path)));
  }
  return hash.digest("hex");
}

function parseOptions(argv) {
  const options = {
    install: false,
    packed: false,
    prepare: false,
    release: false,
    status: false,
    sync: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--install") {
      options.install = true;
    } else if (argument === "--packed") {
      options.packed = true;
    } else if (argument === "--prepare") {
      options.prepare = true;
    } else if (argument === "--release") {
      options.release = true;
    } else if (argument === "--status") {
      options.status = true;
    } else if (argument === "--sync") {
      options.sync = true;
    } else if (argument === "--path" || argument === "--ref") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown option '${argument}'`);
    }
  }
  return options;
}

function validateCheckout(candidate) {
  const checkout = realpathSync(candidate);
  const relativePath = relative(repositoryRoot, checkout);
  if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    throw new Error(
      `WebUI checkout must be outside the benchmark Cargo workspace: ${checkout}`,
    );
  }
  for (const path of [
    resolve(checkout, "Cargo.toml"),
    ...Object.values(packageDirectories).map((directory) =>
      resolve(checkout, "packages", directory, "package.json")
    ),
    resolve(checkout, "crates", "webui-handler", "Cargo.toml"),
    resolve(checkout, "crates", "webui-node", "Cargo.toml"),
  ]) {
    if (!existsSync(path)) {
      throw new Error(`WebUI checkout is missing ${path}`);
    }
  }
  const expectedVersion = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  ).dependencies["@microsoft/webui"];
  const cargoManifest = readFileSync(resolve(checkout, "Cargo.toml"), "utf8");
  const workspacePackage = cargoManifest
    .split("[workspace.package]")[1]
    ?.split(/^\[/mu)[0];
  const cargoVersion = /^version\s*=\s*"([^"]+)"/mu.exec(
    workspacePackage ?? "",
  )?.[1];
  if (cargoVersion !== expectedVersion) {
    throw new Error(
      `microsoft-webui-handler@${cargoVersion ?? "unknown"} cannot replace the benchmark's exact ${expectedVersion} Cargo dependency`,
    );
  }
  for (const [name, directory] of Object.entries(packageDirectories)) {
    const version = JSON.parse(
      readFileSync(
        resolve(checkout, "packages", directory, "package.json"),
        "utf8",
      ),
    ).version;
    if (version !== expectedVersion) {
      throw new Error(
        `${name}@${version} cannot replace the benchmark's exact ${expectedVersion} Cargo dependency`,
      );
    }
  }
  return checkout;
}

function checkoutRef(ref) {
  const repositoryPath = resolve(checkoutCacheRoot, "repository");
  mkdirSync(checkoutCacheRoot, { recursive: true });
  if (!existsSync(resolve(repositoryPath, ".git"))) {
    run(
      "git",
      [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        "https://github.com/microsoft/webui.git",
        repositoryPath,
      ],
    );
  }
  run("git", ["fetch", "--depth", "1", "origin", ref], repositoryPath);
  const commit = gitValue(["rev-parse", "FETCH_HEAD"], repositoryPath);
  if (commit === null || !/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error(`Failed to resolve WebUI ref '${ref}'`);
  }
  const checkout = resolve(checkoutCacheRoot, "checkouts", commit);
  if (!existsSync(resolve(checkout, "Cargo.toml"))) {
    if (existsSync(checkout)) {
      rmSync(checkout, { force: true, recursive: true });
      run("git", ["worktree", "prune"], repositoryPath);
    }
    mkdirSync(dirname(checkout), { recursive: true });
    run(
      "git",
      ["worktree", "add", "--detach", checkout, commit],
      repositoryPath,
    );
  }
  return validateCheckout(checkout);
}

function packageArchiveName(checkout, directory) {
  const manifest = JSON.parse(
    readFileSync(resolve(checkout, "packages", directory, "package.json"), "utf8"),
  );
  return `${manifest.name.replace(/^@/u, "").replace("/", "-")}-${
    manifest.version
  }.tgz`;
}

function buildPackedPackages(checkout) {
  mkdirSync(resolve(repositoryRoot, ".cache"), { recursive: true });
  const stagingPath = mkdtempSync(
    resolve(repositoryRoot, ".cache", "webui-pack-staging-"),
  );
  try {
    prepareCheckout(checkout);
    for (const [name, directory] of Object.entries(packageDirectories)) {
      runPnpm(
        [
          "--filter",
          name,
          "pack",
          "--pack-destination",
          stagingPath,
        ],
        checkout,
      );
      const generatedArchive = resolve(
        stagingPath,
        packageArchiveName(checkout, directory),
      );
      if (!existsSync(generatedArchive)) {
        throw new Error(`${name} did not produce ${generatedArchive}`);
      }
      renameSync(
        generatedArchive,
        resolve(stagingPath, packedArchiveNames[name]),
      );
    }
    mkdirSync(packageCachePath, { recursive: true });
    const previousArtifacts = {};
    const packages = {};
    const packageHashes = {};
    try {
      for (const name of Object.keys(packageDirectories)) {
        const archiveName = packedArchiveNames[name];
        const archive = resolve(packageCachePath, archiveName);
        previousArtifacts[name] = existsSync(archive)
          ? readFileSync(archive)
          : null;
        copyFileSync(resolve(stagingPath, archiveName), archive);
        const contents = readFileSync(archive);
        packages[name] = relative(repositoryRoot, archive).replaceAll("\\", "/");
        packageHashes[name] = createHash("sha256")
          .update(contents)
          .digest("hex");
      }
    } catch (error) {
      restorePackedArtifacts(previousArtifacts);
      throw error;
    }
    return {
      packageHashes,
      packages,
      rollback() {
        restorePackedArtifacts(previousArtifacts);
      },
    };
  } finally {
    rmSync(stagingPath, { force: true, recursive: true });
  }
}

function restorePackedArtifacts(previousArtifacts) {
  for (const [name, contents] of Object.entries(previousArtifacts)) {
    const archive = resolve(packageCachePath, packedArchiveNames[name]);
    if (contents === null) {
      rmSync(archive, { force: true });
    } else {
      writeFileSync(archive, contents);
    }
  }
}

function snapshotSourcePackages(checkout) {
  mkdirSync(resolve(repositoryRoot, ".cache"), { recursive: true });
  const snapshotPath = mkdtempSync(
    resolve(repositoryRoot, ".cache", "webui-source-"),
  );
  const packages = {};
  for (const [name, directory] of Object.entries(packageDirectories)) {
    const source = resolve(checkout, "packages", directory);
    const target = resolve(snapshotPath, directory);
    mkdirSync(target, { recursive: true });
    for (const entry of ["package.json", "dist", "bin", "wasm"]) {
      const sourceEntry = resolve(source, entry);
      if (existsSync(sourceEntry)) {
        cpSync(sourceEntry, resolve(target, entry), {
          force: true,
          recursive: true,
        });
      }
    }
    packages[name] = relative(repositoryRoot, target).replaceAll("\\", "/");
  }
  const platformDirectory = {
    "darwin-arm64": "webui-darwin-arm64",
    "darwin-x64": "webui-darwin-x64",
    "linux-arm64": "webui-linux-arm64",
    "linux-x64": "webui-linux-x64",
    "win32-arm64": "webui-win32-arm64",
    "win32-x64": "webui-win32-x64",
  }[`${process.platform}-${arch()}`];
  const addon = addonPath(checkout);
  if (platformDirectory === undefined || addon === null || !existsSync(addon)) {
    throw new Error("The current platform WebUI addon was not built");
  }
  const platformSource = resolve(
    checkout,
    "packages",
    platformDirectory,
    "package.json",
  );
  const platformTarget = resolve(
    snapshotPath,
    "webui",
    "node_modules",
    "@microsoft",
    platformDirectory,
  );
  mkdirSync(resolve(platformTarget, "bin"), { recursive: true });
  copyFileSync(platformSource, resolve(platformTarget, "package.json"));
  copyFileSync(addon, resolve(platformTarget, "webui.node"));
  const cliName = process.platform === "win32" ? "webui.exe" : "webui";
  copyFileSync(
    resolve(checkout, "target", "release", cliName),
    resolve(platformTarget, "bin", cliName),
  );
  return packages;
}

function cleanupSourceSnapshot(configuration) {
  if (configuration?.mode !== "source") {
    return;
  }
  const firstPackage = Object.values(configuration.packages ?? {})[0];
  if (typeof firstPackage !== "string") {
    return;
  }
  const snapshotPath = dirname(resolve(repositoryRoot, firstPackage));
  const cacheRelative = relative(
    resolve(repositoryRoot, ".cache"),
    snapshotPath,
  );
  if (
    !cacheRelative.startsWith("..")
    && !isAbsolute(cacheRelative)
    && basename(snapshotPath).startsWith("webui-source-")
  ) {
    rmSync(snapshotPath, { force: true, recursive: true });
  }
}

function prepareCheckout(checkout) {
  runPnpm(["install", "--frozen-lockfile", publicRegistry], checkout);
  run(
    process.platform === "win32" ? "cargo.exe" : "cargo",
    [
      "build",
      "--release",
      "-p",
      "microsoft-webui-cli",
      "-p",
      "microsoft-webui-node",
    ],
    checkout,
  );
  runPnpm(
    [
      "--filter",
      "@microsoft/webui",
      "--filter",
      "@microsoft/webui-framework",
      "--filter",
      "@microsoft/webui-delivery",
      "run",
      "build",
    ],
    checkout,
  );
}

function writeConfiguration({
  checkout,
  mode,
  packageHashes = null,
  packages = null,
  requestedRef,
}) {
  const commit = gitValue(["rev-parse", "HEAD"], checkout);
  const status = gitValue(["status", "--porcelain"], checkout);
  if (commit === null || status === null) {
    throw new Error("Failed to identify the configured WebUI checkout");
  }
  const statusHash = workingTreeHash(checkout, status);
  writeFileSync(
    configPath,
    `${JSON.stringify({
      schema: "webui-benchmarks.local/v1",
      mode,
      checkout: relative(repositoryRoot, checkout).replaceAll("\\", "/"),
      requestedRef: requestedRef ?? null,
      snapshot: {
        commit,
        statusHash,
        workingTreeDirty: status.length > 0,
      },
      version: JSON.parse(
        readFileSync(
          resolve(checkout, "packages", "webui", "package.json"),
          "utf8",
        ),
      ).version,
      packageHashes,
      packages,
    }, null, 2)}\n`,
    "utf8",
  );
}

function consumerPackageRoots() {
  return [
    repositoryRoot,
    ...readdirSync(resolve(repositoryRoot, "todo", "apps"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(repositoryRoot, "todo", "apps", entry.name)),
  ].filter((root) => existsSync(resolve(root, "package.json")));
}

function webuiPackageLinks() {
  const links = [];
  for (const root of consumerPackageRoots()) {
    const manifest = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    );
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    };
    for (const [name, directory] of Object.entries(packageDirectories)) {
      if (dependencies[name] !== undefined) {
        links.push({
          directory,
          name,
          path: resolve(root, "node_modules", "@microsoft", directory),
        });
      }
    }
  }
  return links;
}

function snapshotWebuiLinks() {
  return webuiPackageLinks().map((link) => ({
    ...link,
    target: existsSync(link.path) ? realpathSync(link.path) : null,
  }));
}

function linkWebuiPackages(targets) {
  for (const link of webuiPackageLinks()) {
    const target = targets[link.name];
    if (target === undefined || !existsSync(target)) {
      throw new Error(`WebUI package target is missing: ${target ?? link.name}`);
    }
    rmSync(link.path, { force: true, recursive: true });
    mkdirSync(dirname(link.path), { recursive: true });
    symlinkSync(
      target,
      link.path,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

function restoreWebuiLinks(snapshot) {
  for (const link of snapshot) {
    const linkPath = isAbsolute(link.path)
      ? link.path
      : resolve(repositoryRoot, link.path);
    rmSync(linkPath, { force: true, recursive: true });
    if (link.target !== null) {
      mkdirSync(dirname(linkPath), { recursive: true });
      symlinkSync(
        link.target,
        linkPath,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  }
}

function installPackedPackages(configuration) {
  const hash = createHash("sha256");
  for (const name of Object.keys(packageDirectories)) {
    hash.update(configuration.packageHashes[name]);
  }
  const installDirectory = resolve(
    repositoryRoot,
    ".cache",
    "webui-installs",
    hash.digest("hex").slice(0, 16),
  );
  mkdirSync(installDirectory, { recursive: true });
  writeFileSync(
    resolve(installDirectory, "package.json"),
    `${JSON.stringify({
      private: true,
      dependencies: Object.fromEntries(
        Object.entries(configuration.packages).map(([name, path]) => [
          name,
          `file:${resolve(repositoryRoot, path).replaceAll("\\", "/")}`,
        ]),
      ),
    }, null, 2)}\n`,
    "utf8",
  );
  runPnpm(
    [
      "install",
      "--force",
      "--ignore-scripts",
      "--ignore-workspace",
      "--lockfile=false",
      publicRegistry,
    ],
    installDirectory,
  );
  return Object.fromEntries(
    Object.keys(packageDirectories).map((name) => [
      name,
      resolve(installDirectory, "node_modules", ...name.split("/")),
    ]),
  );
}

function activateLocalPackages(configuration) {
  if (configuration.mode === "source") {
    linkWebuiPackages(
      Object.fromEntries(
        Object.keys(packageDirectories).map((name) => [
          name,
          resolve(repositoryRoot, configuration.packages[name]),
        ]),
      ),
    );
    return;
  }
  linkWebuiPackages(installPackedPackages(configuration));
}

function restoreReleasedPackages() {
  let targets = releasedPackageTargets();
  if (targets !== null) {
    linkWebuiPackages(targets);
    return;
  }
  for (const link of webuiPackageLinks()) {
    rmSync(link.path, { force: true, recursive: true });
  }
  rmSync(resolve(repositoryRoot, "node_modules", ".modules.yaml"), {
    force: true,
  });
  rmSync(resolve(repositoryRoot, "node_modules", ".pnpm", "lock.yaml"), {
    force: true,
  });
  runPnpm([
    "install",
    "--force",
    "--frozen-lockfile",
    publicRegistry,
  ]);
  targets = releasedPackageTargets();
  if (targets === null) {
    throw new Error("Released WebUI packages were not installed");
  }
  linkWebuiPackages(targets);
}

function releasedPackageTargets() {
  const virtualStore = resolve(repositoryRoot, "node_modules", ".pnpm");
  if (!existsSync(virtualStore)) {
    return null;
  }
  const expectedVersion = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  ).dependencies["@microsoft/webui"];
  const entries = readdirSync(virtualStore, { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory()
      && !entry.name.includes("@file+")
      && !entry.name.includes("@link+")
    );
  const targets = {};
  for (const name of Object.keys(packageDirectories)) {
    const encodedName = name.replace("/", "+");
    const entry = entries.find((candidate) =>
      candidate.name.startsWith(`${encodedName}@${expectedVersion}`)
    );
    if (entry === undefined) {
      return null;
    }
    const target = resolve(
      virtualStore,
      entry.name,
      "node_modules",
      ...name.split("/"),
    );
    if (!existsSync(target)) {
      return null;
    }
    targets[name] = target;
  }
  return targets;
}

function addonPath(checkout) {
  const fileName = {
    darwin: "libwebui_node.dylib",
    linux: "libwebui_node.so",
    win32: "webui_node.dll",
  }[process.platform];
  return fileName === undefined
    ? null
    : resolve(checkout, "target", "release", fileName);
}

function printStatus() {
  if (!existsSync(configPath)) {
    const manifest = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    );
    process.stdout.write(
      `WebUI mode: release\nVersion: ${
        manifest.dependencies["@microsoft/webui"]
      }\n`,
    );
    return;
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const checkout = validateCheckout(resolve(repositoryRoot, config.checkout));
  const commit = gitValue(["rev-parse", "HEAD"], checkout);
  const status = gitValue(["status", "--porcelain"], checkout);
  const currentStatusHash = status === null
    ? null
    : workingTreeHash(checkout, status);
  const snapshotChanged = config.mode === "packed"
    && (
      commit !== config.snapshot?.commit
      || currentStatusHash !== config.snapshot?.statusHash
    );
  const sourceChanged = config.mode === "source"
    && (
      commit !== config.snapshot?.commit
      || currentStatusHash !== config.snapshot?.statusHash
    );
  const artifactsChanged = config.mode === "packed"
    && Object.entries(config.packages ?? {}).some(([name, archive]) => {
      if (!existsSync(resolve(repositoryRoot, archive))) {
        return true;
      }
      const hash = createHash("sha256")
        .update(readFileSync(resolve(repositoryRoot, archive)))
        .digest("hex");
      return hash !== config.packageHashes?.[name];
    });
  const lines = [
    `WebUI mode: ${config.mode ?? "source"}`,
    `Checkout: ${checkout}`,
    `Commit: ${commit ?? "unavailable"}`,
    `Working tree: ${status?.length ? "dirty" : "clean"}`,
  ];
  if (config.mode === "packed") {
    lines.push(
      `Packed snapshot: ${
        snapshotChanged || artifactsChanged
          ? "stale; run webui:packed again"
          : "current"
      }`,
    );
    for (const [name, archive] of Object.entries(config.packages ?? {})) {
      lines.push(`${name}: ${resolve(repositoryRoot, archive)}`);
    }
  } else {
    lines.push(
      `Source snapshot: ${
        sourceChanged ? "stale; run webui:local again" : "current"
      }`,
    );
    for (const [name, packagePath] of Object.entries(config.packages ?? {})) {
      lines.push(`${name}: ${resolve(repositoryRoot, packagePath)}`);
    }
  }
  const addon = addonPath(checkout);
  lines.push(
    `Cargo patch: ${resolve(checkout, "crates", "webui-handler")}`,
    `Native addon: ${addon ?? "unsupported platform"}${
      addon !== null && !existsSync(addon) ? " (not built)" : ""
    }`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

function main(argv) {
  const options = parseOptions(argv);
  if (options.sync) {
    if (
      options.path !== undefined
      || options.ref !== undefined
      || options.packed
      || options.prepare
      || options.release
      || options.status
    ) {
      throw new Error("--sync cannot be combined with another mode");
    }
    if (!existsSync(configPath)) {
      throw new Error("No local WebUI checkout is configured");
    }
    const previousConfiguration = readFileSync(configPath);
    const config = JSON.parse(previousConfiguration);
    if (config.mode !== "source") {
      throw new Error("--sync requires source-link mode");
    }
    const checkout = validateCheckout(
      resolve(repositoryRoot, config.checkout),
    );
    const previousLinks = snapshotWebuiLinks();
    try {
      prepareCheckout(checkout);
      writeConfiguration({
        checkout,
        mode: "source",
        packages: snapshotSourcePackages(checkout),
        requestedRef: config.requestedRef,
      });
      activateLocalPackages(JSON.parse(readFileSync(configPath, "utf8")));
      cleanupSourceSnapshot(config);
    } catch (error) {
      writeFileSync(configPath, previousConfiguration);
      restoreWebuiLinks(previousLinks);
      throw error;
    }
    process.stdout.write(`Synchronized source WebUI checkout ${checkout}.\n`);
    return;
  }
  if (options.release && options.status) {
    throw new Error("--release and --status cannot be combined");
  }
  if (options.status) {
    if (
      options.path !== undefined
      || options.ref !== undefined
      || options.packed
      || options.prepare
    ) {
      throw new Error("--status does not accept a checkout");
    }
    printStatus();
    return;
  }
  if (options.release) {
    if (
      options.path !== undefined
      || options.ref !== undefined
      || options.packed
      || options.prepare
    ) {
      throw new Error("--release does not accept a checkout");
    }
    const previousConfiguration = existsSync(configPath)
      ? readFileSync(configPath)
      : null;
    const parsedConfiguration = previousConfiguration === null
      ? null
      : JSON.parse(previousConfiguration);
    const previousLinks = snapshotWebuiLinks();
    rmSync(configPath, { force: true });
    try {
      if (options.install) {
        restoreReleasedPackages();
      }
      cleanupSourceSnapshot(parsedConfiguration);
    } catch (error) {
      if (previousConfiguration !== null) {
        writeFileSync(configPath, previousConfiguration);
      }
      restoreWebuiLinks(previousLinks);
      throw error;
    }
    process.stdout.write("Configured released WebUI packages.\n");
    return;
  }
  if ((options.path === undefined) === (options.ref === undefined)) {
    throw new Error(
      "Specify exactly one of --path <checkout> or --ref <git-ref>",
    );
  }
  const checkout = options.path === undefined
    ? checkoutRef(options.ref)
    : validateCheckout(resolve(repositoryRoot, options.path));
  const mode = options.packed ? "packed" : "source";
  const packedBuild = options.packed ? buildPackedPackages(checkout) : null;
  let sourcePackages = null;
  if (options.prepare && !options.packed) {
    prepareCheckout(checkout);
    sourcePackages = snapshotSourcePackages(checkout);
  }
  const previousConfiguration = existsSync(configPath)
    ? readFileSync(configPath)
    : null;
  const previousLinks = snapshotWebuiLinks();
  const previousConfig = previousConfiguration === null
    ? null
    : JSON.parse(previousConfiguration);
  try {
    writeConfiguration({
      checkout,
      mode,
      packages: packedBuild?.packages ?? sourcePackages,
      packageHashes: packedBuild?.packageHashes ?? null,
      requestedRef: options.ref,
    });
    if (options.install) {
      activateLocalPackages(
        JSON.parse(readFileSync(configPath, "utf8")),
      );
    }
    cleanupSourceSnapshot(previousConfig);
  } catch (error) {
    if (previousConfiguration === null) {
      rmSync(configPath, { force: true });
    } else {
      writeFileSync(configPath, previousConfiguration);
    }
    restoreWebuiLinks(previousLinks);
    packedBuild?.rollback();
    throw error;
  }
  process.stdout.write(
    `Configured ${mode} WebUI checkout ${checkout}.\n`,
  );
}

main(process.argv.slice(2));
