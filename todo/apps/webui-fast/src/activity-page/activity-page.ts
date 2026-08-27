// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FASTElement, observable } from "@microsoft/fast-element";
import { declarativeTemplate } from "@microsoft/fast-element/declarative.js";
import { observerMap } from "@microsoft/fast-element/observer-map.js";
import type { RouteLoaderContext } from "@microsoft/webui-router";
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

const EMPTY_ACTIVITY: ActivityState = {
  events: [],
  filters: [],
  unreadCount: 0,
  unreadLabel: "",
};

function initialActivity(): ActivityState {
  const data = document.querySelector("#webui-data");
  if (!(data instanceof HTMLScriptElement)) return EMPTY_ACTIVITY;
  const payload: unknown = JSON.parse(data.textContent ?? "");
  if (
    payload !== null
    && typeof payload === "object"
    && "state" in payload
    && payload.state !== null
    && typeof payload.state === "object"
    && "activity" in payload.state
  ) {
    return payload.state.activity as ActivityState;
  }
  return EMPTY_ACTIVITY;
}

export class ActivityPage extends FASTElement {
  @observable routeReady = false;
  @observable title = "";
  @observable description = "";
  @observable filters: Array<Record<string, unknown>> = [];
  @observable events: Array<Record<string, unknown>> = [];
  @observable unreadCount = 0;
  @observable unreadLabel = "";

  static async loader(
    { signal }: RouteLoaderContext,
  ): Promise<ActivityState> {
    const response = await fetch("/__bench/route-state", { signal });
    if (!response.ok) {
      throw new Error(`Route state returned HTTP ${response.status}`);
    }
    const state: unknown = await response.json();
    if (
      state === null
      || typeof state !== "object"
      || !("activity" in state)
      || state.activity === null
      || typeof state.activity !== "object"
    ) {
      throw new TypeError("Route state is missing activity");
    }
    return state.activity as ActivityState;
  }

  connectedCallback(): void {
    if (this.events.length === 0) {
      this.applyActivity(initialActivity());
    }
    super.connectedCallback();
    this.routeReady = true;
  }

  setState(state: Record<string, unknown>): void {
    const activity = state.activity !== null
        && typeof state.activity === "object"
      ? state.activity as ActivityState
      : state as ActivityState;
    this.applyActivity(activity);
  }

  onClick(event: MouseEvent): void {
    const action = event.composedPath().find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement
        && candidate.dataset.action !== undefined,
    );
    if (action === undefined) return;
    const state = { activity: this.state() };
    if (action.dataset.action === "activity-filter") {
      const filterId = action.dataset.filter;
      if (filterId !== undefined) {
        this.applyActivity(filterActivity(state, filterId).activity);
      }
    } else if (action.dataset.action === "activity-expand") {
      const eventId = action.dataset.eventId;
      if (eventId !== undefined) {
        this.applyActivity(toggleActivityDetail(state, eventId).activity);
      }
    } else if (action.dataset.action === "activity-mark-read") {
      this.applyActivity(markActivityRead(state).activity);
    }
  }

  private state(): ActivityState {
    return {
      description: this.description,
      events: this.events,
      filters: this.filters,
      title: this.title,
      unreadCount: this.unreadCount,
      unreadLabel: this.unreadLabel,
    };
  }

  private applyActivity(activity: ActivityState): void {
    this.title = String(activity.title ?? "");
    this.description = String(activity.description ?? "");
    if (this.filters.length === activity.filters.length) {
      this.filters.forEach((filter, index) => {
        filter.active = activity.filters[index].active;
      });
    } else {
      this.filters = activity.filters;
    }
    if (this.events.length === activity.events.length) {
      this.events.forEach((event, index) => {
        event.expanded = activity.events[index].expanded;
        event.unread = activity.events[index].unread;
        event.visible = activity.events[index].visible;
      });
    } else {
      this.events = activity.events;
    }
    this.unreadCount = activity.unreadCount;
    this.unreadLabel = activity.unreadLabel;
  }
}

void ActivityPage.define(
  { name: "activity-page", template: declarativeTemplate() },
  [observerMap()],
);
