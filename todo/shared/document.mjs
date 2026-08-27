// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function insertBeforeClosingTag(document, tagName, content) {
  const closingTag = `</${tagName}>`;
  const index = document.toLowerCase().lastIndexOf(closingTag);
  if (index === -1) {
    throw new Error(`Controlled SSR document is missing ${closingTag}`);
  }
  return `${document.slice(0, index)}${content}${document.slice(index)}`;
}

export function controlledDocument({
  appId,
  bootstrap = "",
  clientPath,
  fragment,
  initialStateSource = "browser-wrapper",
  state,
}) {
  if (!["browser-wrapper", "ssr-document"].includes(initialStateSource)) {
    throw new RangeError(
      `Unsupported controlled initial-state source '${initialStateSource}'`,
    );
  }
  const scripts = [
    bootstrap,
    initialStateSource === "browser-wrapper"
      ? `<script id="todo-bench-initial-state" type="application/json">${safeJson(state)}</script>`
      : "",
    `<script type="module" src="${clientPath}"></script>`,
  ].join("");
  if (fragment.trimStart().toLowerCase().startsWith("<!doctype html>")) {
    const withMetadata = insertBeforeClosingTag(
      fragment,
      "head",
      `<meta name="todo-browser-app" content="${appId}">`,
    );
    return insertBeforeClosingTag(withMetadata, "body", scripts);
  }
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="todo-browser-app" content="${appId}">`,
    "<title>Dynamic browser outcome · SSR Todo Benchmark</title>",
    '<link rel="stylesheet" href="/__browser/styles.css">',
    "</head>",
    "<body>",
    `<div id="todo-browser-root">${fragment}</div>`,
    scripts,
    "</body>",
    "</html>",
  ].join("");
}
