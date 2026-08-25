// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  BRANCHES,
  COMPONENTS,
  REQUIRED_TEXT,
  SELECTORS,
  SENTINEL_IDS,
} from "./contract.mjs";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function decodeHtml(value) {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|apos|gt|lt|quot);/giu,
    (entity, decimal, hexadecimal) => {
      if (decimal !== undefined) {
        return String.fromCodePoint(Number(decimal));
      }
      if (hexadecimal !== undefined) {
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      }
      return {
        "&amp;": "&",
        "&apos;": "'",
        "&gt;": ">",
        "&lt;": "<",
        "&quot;": '"',
      }[entity.toLowerCase()] ?? entity;
    },
  );
}

function visibleText(html) {
  return decodeHtml(
    html
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  );
}

function stripInertContents(html) {
  return html
    .replace(
      /<f-template\b[^>]*>[\s\S]*?<\/f-template>/giu,
      "<f-template></f-template>",
    )
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "<script></script>")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "<style></style>");
}

function parseAttributes(source) {
  const attributes = Object.create(null);
  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
  let match = pattern.exec(source);
  while (match !== null) {
    attributes[match[1].toLowerCase()] = decodeHtml(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
    match = pattern.exec(source);
  }
  return attributes;
}

function classList(attributes) {
  return (attributes.class ?? "").split(/\s+/u).filter(Boolean);
}

function hasClass(attributes, className) {
  return classList(attributes).includes(className);
}

function openingElements(html) {
  const elements = [];
  const pattern = /<([a-z][\w:-]*)\b([^<>]*?)\/?>/giu;
  let match = pattern.exec(html);
  while (match !== null) {
    const tagName = match[1].toLowerCase();
    elements.push({
      attributes: parseAttributes(match[2]),
      tagName,
      void: VOID_ELEMENTS.has(tagName) || match[0].endsWith("/>"),
    });
    match = pattern.exec(html);
  }
  return elements;
}

function pairedElements(html, tagName) {
  const elements = [];
  const pattern = new RegExp(
    `<${tagName}\\b([^<>]*?)>([\\s\\S]*?)<\\/${tagName}>`,
    "giu",
  );
  let match = pattern.exec(html);
  while (match !== null) {
    elements.push({
      attributes: parseAttributes(match[1]),
      body: match[2],
      text: visibleText(match[2]),
    });
    match = pattern.exec(html);
  }
  return elements;
}

function firstByClass(elements, className) {
  return elements.find((element) =>
    hasClass(element.attributes, className)
  );
}

function elementsByClass(elements, className) {
  return elements.filter((element) =>
    hasClass(element.attributes, className)
  );
}

function booleanAttribute(attributes, name) {
  return Object.hasOwn(attributes, name);
}

function nullableAttribute(attributes, name) {
  return Object.hasOwn(attributes, name) ? attributes[name] : null;
}

function collectToolbar(html) {
  const section = pairedElements(html, "section").find((element) =>
    hasClass(element.attributes, "todo-toolbar")
  );
  if (section === undefined) {
    return {
      children: { button: 0, filter: 0, selectionSummary: 0 },
      clearButton: null,
      filters: [],
      selectionText: "",
    };
  }

  const buttons = pairedElements(section.body, "button");
  const filters = elementsByClass(buttons, "todo-filter").map((button) => {
    const spans = pairedElements(button.body, "span");
    const count = firstByClass(spans, "todo-filter__count");
    const label = spans.find((span) =>
      !hasClass(span.attributes, "todo-filter__count")
    );
    return {
      action: nullableAttribute(button.attributes, "data-action"),
      ariaPressed: nullableAttribute(button.attributes, "aria-pressed"),
      countText: count?.text ?? "",
      id: nullableAttribute(button.attributes, "data-filter"),
      label: label?.text ?? "",
    };
  });
  const todoButtons = elementsByClass(buttons, "todo-button");
  const clearButton = todoButtons.find(
    (button) => button.attributes["data-action"] === "clear-completed",
  );
  const selectionSpans = pairedElements(section.body, "span").filter((span) =>
    hasClass(span.attributes, "todo-toolbar__selection")
  );

  return {
    children: {
      button: todoButtons.length,
      filter: filters.length,
      selectionSummary: selectionSpans.length,
    },
    clearButton: clearButton === undefined
      ? null
      : {
          action: nullableAttribute(clearButton.attributes, "data-action"),
          ariaPressed: nullableAttribute(
            clearButton.attributes,
            "aria-pressed",
          ),
          disabled: booleanAttribute(clearButton.attributes, "disabled"),
          label: clearButton.text,
          todoId: nullableAttribute(clearButton.attributes, "data-todo-id"),
        },
    filters,
    selectionText: selectionSpans[0]?.text ?? "",
  };
}

function collectItem(item) {
  const attributes = item.attributes;
  const elements = openingElements(item.body);
  const badges = elementsByClass(elements, "todo-badge");
  const checkboxes = elementsByClass(elements, "todo-checkbox");
  const tagLists = elementsByClass(elements, "todo-tag-list");
  const buttons = pairedElements(item.body, "button");
  const selectButtons = elementsByClass(buttons, "todo-button").filter(
    (button) => button.attributes["data-action"] === "select",
  );
  const metaRegions = pairedElements(item.body, "div").filter((element) =>
    hasClass(element.attributes, "todo-item__meta")
  );
  const metadata = metaRegions.length === 1
    ? pairedElements(metaRegions[0].body, "span").map((span) => span.text)
    : [];
  const tags = pairedElements(item.body, "span")
    .filter((element) => hasClass(element.attributes, "todo-tag"))
    .map((tag) => ({
      id: nullableAttribute(tag.attributes, "data-tag-id"),
      label: tag.text,
    }));
  const checkbox = checkboxes[0];
  const selectButton = selectButtons[0];
  const title = pairedElements(item.body, "strong").find((element) =>
    hasClass(element.attributes, "todo-item__title")
  );

  return {
    ariaSelected: nullableAttribute(attributes, "aria-selected"),
    branches: badges.map((badge) =>
      nullableAttribute(badge.attributes, "data-branch")
    ),
    checkbox: checkbox === undefined
      ? null
      : {
          action: nullableAttribute(checkbox.attributes, "data-action"),
          checked: booleanAttribute(checkbox.attributes, "checked"),
          todoId: nullableAttribute(checkbox.attributes, "data-todo-id"),
        },
    children: {
      badge: badges.length,
      button: selectButtons.length,
      checkbox: checkboxes.length,
      tagList: tagLists.length,
    },
    id: nullableAttribute(attributes, "data-todo-id"),
    metadata,
    metaRegionCount: metaRegions.length,
    selectButton: selectButton === undefined
      ? null
      : {
          action: nullableAttribute(selectButton.attributes, "data-action"),
          ariaPressed: nullableAttribute(
            selectButton.attributes,
            "aria-pressed",
          ),
          label: selectButton.text,
          todoId: nullableAttribute(selectButton.attributes, "data-todo-id"),
        },
    tags,
    title: title?.text ?? "",
  };
}

function selectorCounts(elements, items, toolbar) {
  const classCount = (className) =>
    elementsByClass(elements, className).length;
  return {
    "todo-app": classCount("todo-app"),
    "todo-header": classCount("todo-header"),
    "todo-summary": classCount("todo-summary"),
    "todo-toolbar": classCount("todo-toolbar"),
    "todo-filter": classCount("todo-filter"),
    "todo-list": classCount("todo-list"),
    "todo-item": classCount("todo-item"),
    "todo-checkbox": classCount("todo-checkbox"),
    "todo-badge": classCount("todo-badge"),
    "todo-tag-list": classCount("todo-tag-list"),
    "todo-button": classCount("todo-button"),
    "todo-footer": classCount("todo-footer"),
    "todo-tag": classCount("todo-tag"),
    "todo-toolbar-selection": toolbar.children.selectionSummary,
    "todo-item-meta": items.reduce(
      (total, item) => total + item.metaRegionCount,
      0,
    ),
    "todo-item-meta-span": items.reduce(
      (total, item) => total + item.metadata.length,
      0,
    ),
    "aria-pressed": elements.filter((element) =>
      Object.hasOwn(element.attributes, "aria-pressed")
    ).length,
  };
}

export function collectHtmlObservation(html) {
  if (typeof html !== "string") {
    throw new TypeError("collectHtmlObservation requires an HTML string");
  }
  const visibleHtml = stripInertContents(html);
  const elements = openingElements(visibleHtml);
  const itemElements = pairedElements(visibleHtml, "li").filter((element) =>
    hasClass(element.attributes, "todo-item")
  );
  const items = itemElements.map(collectItem);
  const toolbar = collectToolbar(visibleHtml);
  const counts = selectorCounts(elements, items, toolbar);
  const itemIds = items.map((item) => item.id);
  const actionElements = elements.filter((element) =>
    Object.hasOwn(element.attributes, "data-action")
  );
  const actionTargets = (action, attribute) =>
    actionElements
      .filter((element) => element.attributes["data-action"] === action)
      .map((element) => element.attributes[attribute] ?? action);
  const visiblePageText = visibleText(visibleHtml);

  return {
    branchCounts: Object.fromEntries(
      BRANCHES.map((branch) => [
        branch.id,
        elements.filter(
          (element) => element.attributes["data-branch"] === branch.id,
        ).length,
      ]),
    ),
    componentNames: COMPONENTS.filter((component) => counts[component] > 0),
    interactionCounts: {
      filter: actionTargets("filter", "data-filter").length,
      select: actionTargets("select", "data-todo-id").length,
      "toggle-completion": actionTargets(
        "toggle-completion",
        "data-todo-id",
      ).length,
      "clear-completed": actionTargets(
        "clear-completed",
        "data-action",
      ).length,
    },
    interactionTargets: {
      filter: actionTargets("filter", "data-filter"),
      select: actionTargets("select", "data-todo-id"),
      "toggle-completion": actionTargets(
        "toggle-completion",
        "data-todo-id",
      ),
      "clear-completed": actionTargets(
        "clear-completed",
        "data-action",
      ),
    },
    itemIds,
    raw: {
      byteLength: new TextEncoder().encode(html).length,
      commentCount: [...html.matchAll(/<!--[\s\S]*?-->/gu)].length,
      customElementHostCount: elements.filter((element) =>
        element.tagName.startsWith("todo-")
      ).length,
      hostAttributeCount: elements
        .filter((element) => element.tagName.startsWith("todo-"))
        .reduce(
          (total, element) =>
            total + Object.keys(element.attributes).length,
          0,
        ),
      html,
      nodeCount: elements.length,
    },
    selectorCounts: Object.fromEntries(
      SELECTORS.map((selector) => [selector.id, counts[selector.id] ?? 0]),
    ),
    sentinelIds: SENTINEL_IDS.filter((id) => itemIds.includes(id)),
    tagIdsByTodo: Object.fromEntries(
      items.map((item) => [
        item.id,
        item.tags.map((tag) => tag.id),
      ]),
    ),
    textCounts: Object.fromEntries(
      REQUIRED_TEXT.map((entry) => [
        entry.id,
        visiblePageText.split(entry.text).length - 1,
      ]),
    ),
    visibleSubtree: { toolbar, items },
  };
}

export function normalizeTodoOutput(output) {
  if (typeof output === "string") {
    return collectHtmlObservation(output);
  }
  if (ArrayBuffer.isView(output)) {
    return collectHtmlObservation(
      new TextDecoder().decode(
        new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
      ),
    );
  }
  throw new TypeError("todo renderer output must be a string or byte view");
}

export function semanticObservation(observation) {
  const { raw: _raw, ...semantic } = observation;
  return semantic;
}
