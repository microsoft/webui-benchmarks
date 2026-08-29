// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const { existsSync, readFileSync, realpathSync } = require("node:fs");
const { resolve } = require("node:path");

const repositoryRoot = __dirname;
const configPath = resolve(repositoryRoot, ".webui-local.json");
const packageDirectories = Object.freeze({
  "@microsoft/webui": "webui",
  "@microsoft/webui-framework": "webui-framework",
  "@microsoft/webui-router": "webui-router",
});

function configuredDependency() {
  const configured = process.env.WEBUI_CHECKOUT
    ? {
        checkout: process.env.WEBUI_CHECKOUT,
        mode: "source",
      }
    : existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf8"))
      : null;
  if (configured === null) {
    return null;
  }
  const checkout = realpathSync(
    resolve(repositoryRoot, configured.checkout),
  );
  if (!existsSync(resolve(checkout, "packages", "webui", "package.json"))) {
    throw new Error(`WEBUI_CHECKOUT is not a WebUI checkout: ${checkout}`);
  }
  return {
    ...configured,
    checkout,
    mode: configured.mode ?? "source",
  };
}

function packageSpecifiers(configuration) {
  if (configuration.mode === "source") {
    return Object.fromEntries(
      Object.entries(packageDirectories).map(([name, directory]) => [
        name,
        `link:${
          (
            typeof configuration.packages?.[name] === "string"
              ? resolve(repositoryRoot, configuration.packages[name])
              : resolve(configuration.checkout, "packages", directory)
          )
            .replaceAll("\\", "/")
        }`,
      ]),
    );
  }
  if (configuration.mode === "packed") {
    if (
      configuration.packages === null
      || typeof configuration.packages !== "object"
    ) {
      throw new Error("Packed WebUI configuration is missing package artifacts");
    }
    return Object.fromEntries(
      Object.keys(packageDirectories).map((name) => {
        const artifact = configuration.packages[name];
        if (typeof artifact !== "string") {
          throw new Error(`Packed WebUI configuration is missing ${name}`);
        }
        return [
          name,
          `file:${resolve(repositoryRoot, artifact).replaceAll("\\", "/")}`,
        ];
      }),
    );
  }
  throw new Error(`Unsupported local WebUI mode '${configuration.mode}'`);
}

function rewriteDependencies(dependencies, configuration) {
  if (!dependencies) {
    return dependencies;
  }
  const rewritten = { ...dependencies };
  for (const [name, specifier] of Object.entries(
    packageSpecifiers(configuration),
  )) {
    if (rewritten[name] !== undefined) {
      rewritten[name] = specifier;
    }
  }
  return rewritten;
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      const configuration = configuredDependency();
      if (configuration === null) {
        return pkg;
      }
      return {
        ...pkg,
        dependencies: rewriteDependencies(pkg.dependencies, configuration),
        devDependencies: rewriteDependencies(
          pkg.devDependencies,
          configuration,
        ),
        optionalDependencies: rewriteDependencies(
          pkg.optionalDependencies,
          configuration,
        ),
      };
    },
  },
  packageSpecifiers,
  rewriteDependencies,
};
