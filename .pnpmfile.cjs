// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const { existsSync, readFileSync, realpathSync } = require("node:fs");
const { resolve } = require("node:path");

const repositoryRoot = __dirname;
const configPath = resolve(repositoryRoot, ".webui-local.json");
const packageDirectories = Object.freeze({
  "@microsoft/webui": "webui",
  "@microsoft/webui-framework": "webui-framework",
});

function configuredCheckout() {
  const configured = process.env.WEBUI_CHECKOUT
    ?? (existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf8")).checkout
      : undefined);
  if (!configured) {
    return null;
  }
  const checkout = realpathSync(resolve(repositoryRoot, configured));
  if (!existsSync(resolve(checkout, "packages", "webui", "package.json"))) {
    throw new Error(`WEBUI_CHECKOUT is not a WebUI checkout: ${checkout}`);
  }
  return checkout;
}

function rewriteDependencies(dependencies, checkout) {
  if (!dependencies) {
    return dependencies;
  }
  const rewritten = { ...dependencies };
  for (const [name, directory] of Object.entries(packageDirectories)) {
    if (rewritten[name] !== undefined) {
      const packagePath = resolve(checkout, "packages", directory)
        .replaceAll("\\", "/");
      rewritten[name] = `link:${packagePath}`;
    }
  }
  return rewritten;
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      const checkout = configuredCheckout();
      if (checkout === null) {
        return pkg;
      }
      return {
        ...pkg,
        dependencies: rewriteDependencies(pkg.dependencies, checkout),
        devDependencies: rewriteDependencies(pkg.devDependencies, checkout),
        optionalDependencies: rewriteDependencies(
          pkg.optionalDependencies,
          checkout,
        ),
      };
    },
  },
};
