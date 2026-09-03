// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { unsafeCSS } from "lit";
import sharedStyles from "../../shared/styles.css" with { type: "text" };
import settingToggleStyles from "./components/styles/setting-toggle.css" with { type: "text" };
import todoAppStyles from "./components/styles/todo-app.css" with { type: "text" };
import todoBadgeStyles from "./components/styles/todo-badge.css" with { type: "text" };
import todoButtonStyles from "./components/styles/todo-button.css" with { type: "text" };
import todoCheckboxStyles from "./components/styles/todo-checkbox.css" with { type: "text" };
import todoFilterStyles from "./components/styles/todo-filter.css" with { type: "text" };
import todoFooterStyles from "./components/styles/todo-footer.css" with { type: "text" };
import todoHeaderStyles from "./components/styles/todo-header.css" with { type: "text" };
import todoItemStyles from "./components/styles/todo-item.css" with { type: "text" };
import todoListStyles from "./components/styles/todo-list.css" with { type: "text" };
import todoSummaryStyles from "./components/styles/todo-summary.css" with { type: "text" };
import todoTagListStyles from "./components/styles/todo-tag-list.css" with { type: "text" };
import todoToolbarStyles from "./components/styles/todo-toolbar.css" with { type: "text" };

/**
 * Component-scoped stylesheets, matched one-for-one with the WebUI FAST V3 row
 * so both shadow-DOM products carry the identical per-component CSS payload.
 * The shell, the two secondary routes, and workspace intelligence own layout
 * that lives in the shared sheet, exactly as the FAST build wires them.
 */
export const shared = unsafeCSS(sharedStyles);
export const settingToggle = unsafeCSS(settingToggleStyles);
export const todoApp = unsafeCSS(todoAppStyles);
export const todoBadge = unsafeCSS(todoBadgeStyles);
export const todoButton = unsafeCSS(todoButtonStyles);
export const todoCheckbox = unsafeCSS(todoCheckboxStyles);
export const todoFilter = unsafeCSS(todoFilterStyles);
export const todoFooter = unsafeCSS(todoFooterStyles);
export const todoHeader = unsafeCSS(todoHeaderStyles);
export const todoItem = unsafeCSS(todoItemStyles);
export const todoList = unsafeCSS(todoListStyles);
export const todoSummary = unsafeCSS(todoSummaryStyles);
export const todoTagList = unsafeCSS(todoTagListStyles);
export const todoToolbar = unsafeCSS(todoToolbarStyles);
