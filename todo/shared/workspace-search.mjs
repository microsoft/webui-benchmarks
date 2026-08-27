// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import MiniSearch from "minisearch";

export function searchWorkspaceIds(todos, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return new Set(todos.map(({ id }) => id));
  }
  const exactMatches = todos.filter((todo) =>
    [
      todo.assigneeLabel,
      todo.description,
      todo.id,
      todo.priorityLabel,
      todo.statusLabel,
      todo.title,
      ...todo.tags.map(({ label }) => label),
    ].some((value) => value.toLowerCase().includes(normalized))
  );
  if (exactMatches.length > 0) {
    return new Set(exactMatches.map(({ id }) => id));
  }
  const index = new MiniSearch({
    fields: [
      "assignee",
      "description",
      "id",
      "priority",
      "status",
      "tags",
      "title",
    ],
    idField: "id",
    storeFields: ["id"],
  });
  index.addAll(
    todos.map((todo) => ({
      assignee: todo.assigneeLabel,
      description: todo.description,
      id: todo.id,
      priority: todo.priorityLabel,
      status: todo.statusLabel,
      tags: todo.tags.map(({ label }) => label).join(" "),
      title: todo.title,
    })),
  );
  return new Set(
    index.search(normalized, {
      combineWith: "AND",
      fuzzy: 0.2,
      prefix: true,
    }).map(({ id }) => String(id)),
  );
}
