// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  enum as zodEnum,
  object as zodObject,
  string as zodString,
} from "zod";
import {
  WORKSPACE_ASSIGNMENT_IDS,
  WORKSPACE_PRIORITY_IDS,
  WORKSPACE_SORT_IDS,
  WORKSPACE_STATUS_IDS,
  WORKSPACE_VIEW_IDS,
} from "./workspace-intelligence-core.mjs";

const savedViewSchema = zodObject({
  assignment: zodEnum(WORKSPACE_ASSIGNMENT_IDS),
  id: zodString().min(1).max(64),
  label: zodString().min(1).max(64),
  priority: zodEnum(WORKSPACE_PRIORITY_IDS),
  query: zodString().max(120),
  sort: zodEnum(WORKSPACE_SORT_IDS),
  status: zodEnum(WORKSPACE_STATUS_IDS),
  view: zodEnum(WORKSPACE_VIEW_IDS),
});

export function parseSavedWorkspaceView(candidate) {
  return savedViewSchema.safeParse(candidate);
}
