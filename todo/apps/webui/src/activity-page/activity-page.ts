// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { WebUIElement, observable } from "@microsoft/webui-framework";
import {
  filterActivity,
  markActivityRead,
  toggleActivityDetail,
} from "../../../../shared/workspace-interactions.mjs";

interface ActivityState {
  filters: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  unreadCount: number;
  unreadLabel: string;
  [key: string]: unknown;
}

export class ActivityPage extends WebUIElement {
  @observable routeReady = false;
  @observable activity: ActivityState = {
    events: [],
    filters: [],
    unreadCount: 0,
    unreadLabel: "",
  };

  protected override hydratedCallback(): void {
    this.routeReady = true;
  }

  onClick(event: MouseEvent): void {
    const action = event.composedPath().find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return;
    const state = { activity: this.activity };
    if (action.dataset.action === "activity-filter") {
      const filterId = action.dataset.filter;
      if (filterId !== undefined) {
        this.activity = filterActivity(state, filterId).activity;
      }
    } else if (action.dataset.action === "activity-expand") {
      const eventId = action.dataset.eventId;
      if (eventId !== undefined) {
        this.activity = toggleActivityDetail(state, eventId).activity;
      }
    } else if (action.dataset.action === "activity-mark-read") {
      this.activity = markActivityRead(state).activity;
    }
  }
}

ActivityPage.define("activity-page");
