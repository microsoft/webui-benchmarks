// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { build as buildBundle } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(here, "dist");
const serverArtifactPath = resolve(outputDirectory, "server.mjs");
const clientArtifactPath = resolve(outputDirectory, "client.mjs");
const componentsArtifactPath = resolve(outputDirectory, "components.mjs");
const stylesPath = resolve(here, "..", "..", "shared", "styles.css");
const banner = {
  js: "// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT license.",
};

let compiler;
let buildPromise;

// `<todo-*>` hosts are plain custom elements, never Vue components: without this
// the compiler would resolve `<todo-item>` to the SFC that renders it.
function isCustomElement(tag) {
  return tag.startsWith("todo-");
}

function loadSfcCompiler() {
  if (compiler !== undefined) {
    return compiler;
  }
  const requireHere = createRequire(import.meta.url);
  try {
    compiler = requireHere("@vue/compiler-sfc");
  } catch {
    try {
      compiler = createRequire(requireHere.resolve("vue"))(
        "@vue/compiler-sfc",
      );
    } catch (cause) {
      throw new Error(
        "@vue/compiler-sfc is required to compile the Vue todo single file "
          + "components; add it as a direct dependency of the benchmark package",
        { cause },
      );
    }
  }
  return compiler;
}

function scopeId(path) {
  return createHash("sha256")
    .update(relative(here, path).replaceAll("\\", "/"))
    .digest("hex")
    .slice(0, 8);
}

function singleFileComponentPlugin(ssr) {
  return {
    name: "todo-vue-sfc",
    setup(esbuild) {
      esbuild.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
        const { compileScript, parse } = loadSfcCompiler();
        const source = await readFile(path, "utf8");
        const { descriptor, errors } = parse(source, {
          filename: path,
          templateParseOptions: { isCustomElement },
        });
        if (errors.length > 0) {
          throw new Error(
            `${path} is not a valid single file component: ${
              errors.map((error) => error.message).join("; ")
            }`,
          );
        }
        if (descriptor.scriptSetup === null) {
          throw new Error(`${path} must declare a <script setup> block`);
        }
        if (descriptor.template === null) {
          throw new Error(`${path} must declare a <template> block`);
        }
        const compiled = compileScript(descriptor, {
          id: scopeId(path),
          inlineTemplate: true,
          isProd: true,
          templateOptions: {
            compilerOptions: { isCustomElement },
            ssr,
            ssrCssVars: [],
          },
        });
        return {
          contents: compiled.content,
          loader: "js",
          resolveDir: dirname(path),
        };
      });
    },
  };
}

function buildServer() {
  return buildBundle({
    banner,
    bundle: true,
    entryPoints: [resolve(here, "server.mjs")],
    external: ["vue", "vue/*", "@vue/*"],
    format: "esm",
    legalComments: "none",
    minify: true,
    outfile: serverArtifactPath,
    platform: "node",
    plugins: [singleFileComponentPlugin(true)],
    target: "node22",
  });
}

function buildBrowser() {
  return buildBundle({
    banner,
    bundle: true,
    define: { "process.env.NODE_ENV": '"production"' },
    entryPoints: [resolve(here, "client.mjs")],
    format: "esm",
    legalComments: "none",
    minify: true,
    outfile: clientArtifactPath,
    platform: "browser",
    plugins: [singleFileComponentPlugin(false)],
    target: "chrome120",
  });
}

// Client-mode components with `vue` left external, so any host bundler - the
// browser runner, or a test - can consume the very same compiled sources.
function buildComponents() {
  return buildBundle({
    banner,
    bundle: true,
    entryPoints: [resolve(here, "client.mjs")],
    external: ["vue", "vue/*", "@vue/*"],
    format: "esm",
    legalComments: "none",
    outfile: componentsArtifactPath,
    platform: "neutral",
    plugins: [singleFileComponentPlugin(false)],
    target: "es2022",
  });
}

export function build() {
  buildPromise ??= Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    readFile(stylesPath, "utf8"),
  ]).then(async ([, css]) => {
    await Promise.all([buildServer(), buildBrowser(), buildComponents()]);
    return {
      artifactPath: serverArtifactPath,
      clientArtifactPath,
      componentsArtifactPath,
      css,
    };
  });
  return buildPromise;
}
