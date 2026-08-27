// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

"use client";

import { useEffect, useState } from "react";
import {
  filterActivity,
  markActivityRead,
  toggleActivityDetail,
} from "../../../shared/workspace-interactions.mjs";

export function ActivityPage({ state }) {
  const [current, setCurrent] = useState(state);
  const [routeReady, setRouteReady] = useState(false);
  const activity = current.activity;
  useEffect(() => setRouteReady(true), []);

  return (
    <main
      className="workspace-page activity-page"
      data-route-page="activity"
      data-route-ready={routeReady || undefined}
    >
      <header className="workspace-page__header">
        <div>
          <h1>{activity.title}</h1>
          <p>{activity.description}</p>
        </div>
        <button
          className="workspace-action"
          data-action="activity-mark-read"
          disabled={activity.unreadCount === 0}
          onClick={() => setCurrent(markActivityRead)}
          type="button"
        >
          Mark all read
          <span>{activity.unreadLabel}</span>
        </button>
      </header>
      <div className="activity-filters" aria-label="Activity filters">
        {activity.filters.map((filter) => (
          <button
            aria-pressed={filter.active}
            className="activity-filter"
            data-action="activity-filter"
            data-filter={filter.id}
            key={filter.id}
            onClick={() =>
              setCurrent((value) => filterActivity(value, filter.id))}
            type="button"
          >
            {filter.label}
            <span>{filter.countLabel}</span>
          </button>
        ))}
      </div>
      <ol className="activity-list">
        {activity.events.map((event) => (
          <li
            className="activity-event"
            data-event-id={event.id}
            data-unread={event.unread || undefined}
            hidden={!event.visible}
            key={event.id}
          >
            <button
              aria-expanded={event.expanded}
              className="activity-event__toggle"
              data-action="activity-expand"
              data-event-id={event.id}
              onClick={() =>
                setCurrent((value) =>
                  toggleActivityDetail(value, event.id)
                )}
              type="button"
            >
              <span className="activity-event__type">{event.typeLabel}</span>
              <strong>{event.actor} {event.action} {event.target}</strong>
              <time>{event.timeLabel}</time>
            </button>
            {event.expanded && (
              <p className="activity-event__detail">{event.detail}</p>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
