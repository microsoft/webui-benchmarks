// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { For, Show, createSignal, onMount } from "solid-js";
import {
  filterActivity,
  markActivityRead,
  toggleActivityDetail,
} from "../../../shared/workspace-interactions.mjs";

export function ActivityPage(props) {
  const [current, setCurrent] = createSignal(props.state);
  const [routeReady, setRouteReady] = createSignal(false);
  const activity = () => current().activity;
  onMount(() => setRouteReady(true));

  return (
    <main
      class="workspace-page activity-page"
      data-route-page="activity"
      data-route-ready={routeReady() || undefined}
    >
      <header class="workspace-page__header">
        <div>
          <h1>{activity().title}</h1>
          <p>{activity().description}</p>
        </div>
        <button
          class="workspace-action"
          data-action="activity-mark-read"
          disabled={activity().unreadCount === 0}
          onClick={() => setCurrent(markActivityRead)}
          type="button"
        >
          Mark all read
          <span>{activity().unreadLabel}</span>
        </button>
      </header>
      <div class="activity-filters" aria-label="Activity filters">
        <For each={activity().filters}>
          {(filter) => (
            <button
              aria-pressed={filter.active}
              class="activity-filter"
              data-action="activity-filter"
              data-filter={filter.id}
              onClick={() =>
                setCurrent((value) => filterActivity(value, filter.id))}
              type="button"
            >
              {filter.label}
              <span>{filter.countLabel}</span>
            </button>
          )}
        </For>
      </div>
      <ol class="activity-list">
        <For each={activity().events}>
          {(event) => (
            <li
              class="activity-event"
              data-event-id={event.id}
              data-unread={event.unread || undefined}
              hidden={!event.visible}
            >
              <button
                aria-expanded={event.expanded}
                class="activity-event__toggle"
                data-action="activity-expand"
                data-event-id={event.id}
                onClick={() =>
                  setCurrent((value) =>
                    toggleActivityDetail(value, event.id)
                  )}
                type="button"
              >
                <span class="activity-event__type">{event.typeLabel}</span>
                <strong>{event.actor} {event.action} {event.target}</strong>
                <time>{event.timeLabel}</time>
              </button>
              <Show when={event.expanded}>
                <p class="activity-event__detail">{event.detail}</p>
              </Show>
            </li>
          )}
        </For>
      </ol>
    </main>
  );
}
