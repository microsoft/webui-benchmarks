// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { csvFormat } from "d3-dsv";

export function createWorkspaceCsv(rows) {
  return csvFormat(
    rows.map((row) => ({
      due: row.dueLabel,
      id: row.id,
      owner: row.owner,
      priority: row.priorityLabel,
      status: row.statusLabel,
      title: row.title,
    })),
  );
}
