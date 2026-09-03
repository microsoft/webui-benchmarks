// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { shared } from "../component-styles.mjs";
import {
  filterActivity,
  markActivityRead,
  toggleActivityDetail,
} from "../../../shared/workspace-interactions.mjs";

/**
 * Secondary route page ported 1:1 from the FAST activity-page. State arrives as
 * reactive properties from the parent workspace-app; this element owns the
 * delegated click handling and reduces through the shared reducers, mutating
 * its own reactive properties in place exactly like the FAST applyActivity.
 */
export class ActivityPage extends LitElement {
  static properties = {
    routeReady: { type: Boolean },
    title: {},
    description: {},
    filters: { type: Array },
    events: { type: Array },
    unreadCount: { type: Number },
    unreadLabel: {},
  };

  static styles = shared;

  constructor() {
    super();
    this.routeReady = false;
    this.title = "";
    this.description = "";
    this.filters = [];
    this.events = [];
    this.unreadCount = 0;
    this.unreadLabel = "";
  }

  firstUpdated() {
    this.routeReady = true;
  }

  onClick = (event) => {
    const action = event.composedPath().find(
      (candidate) =>
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
  };

  state() {
    return {
      description: this.description,
      events: this.events,
      filters: this.filters,
      title: this.title,
      unreadCount: this.unreadCount,
      unreadLabel: this.unreadLabel,
    };
  }

  applyActivity(activity) {
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
    this.requestUpdate();
  }

  render() {
    return html`<main
      class="workspace-page activity-page"
      data-route-page="activity"
      ?data-route-ready=${this.routeReady}
      @click=${this.onClick}
    >
      <header class="workspace-page__header">
        <div>
          <h1>${this.title}</h1>
          <p>${this.description}</p>
        </div>
        <button
          class="workspace-action"
          data-action="activity-mark-read"
          ?disabled=${this.unreadCount == 0}
          type="button"
        >
          Mark all read
          <span>${this.unreadLabel}</span>
        </button>
      </header>
      <div class="activity-filters" aria-label="Activity filters">
        ${repeat(
          this.filters,
          (filter) => filter.id,
          (filter) => html`<button
            aria-pressed="${filter.active}"
            class="activity-filter"
            data-action="activity-filter"
            data-filter="${filter.id}"
            type="button"
          >
            ${filter.label}
            <span>${filter.countLabel}</span>
          </button>`,
        )}
      </div>
      <ol class="activity-list">
        ${repeat(
          this.events,
          (event) => event.id,
          (event) => html`<li
            class="activity-event"
            data-event-id="${event.id}"
            ?data-unread=${event.unread}
            ?hidden=${!event.visible}
          >
            <button
              aria-expanded="${event.expanded}"
              class="activity-event__toggle"
              data-action="activity-expand"
              data-event-id="${event.id}"
              type="button"
            >
              <span class="activity-event__type">${event.typeLabel}</span>
              <strong>${event.actor} ${event.action} ${event.target}</strong>
              <time>${event.timeLabel}</time>
            </button>
            ${event.expanded
              ? html`<p class="activity-event__detail">${event.detail}</p>`
              : ""}
          </li>`,
        )}
      </ol>
    </main>`;
  }
}

customElements.define("activity-page", ActivityPage);
