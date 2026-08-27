<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import {
    filterActivity,
    markActivityRead,
    toggleActivityDetail,
  } from "../../../../../shared/workspace-interactions.mjs";
  import { onMount } from "svelte";

  export let state;
  let current = state;
  let routeReady = false;
  onMount(() => {
    routeReady = true;
  });

  function applyFilter(filterId) {
    current = filterActivity(current, filterId);
  }

  function expand(eventId) {
    current = toggleActivityDetail(current, eventId);
  }

  function markRead() {
    current = markActivityRead(current);
  }
</script>

<main
  class="workspace-page activity-page"
  data-route-page="activity"
  data-route-ready={routeReady || undefined}
>
  <header class="workspace-page__header">
    <div>
      <h1>{current.activity.title}</h1>
      <p>{current.activity.description}</p>
    </div>
    <button
      class="workspace-action"
      data-action="activity-mark-read"
      disabled={current.activity.unreadCount === 0}
      on:click={markRead}
      type="button"
    >
      Mark all read
      <span>{current.activity.unreadLabel}</span>
    </button>
  </header>
  <div class="activity-filters" aria-label="Activity filters">
    {#each current.activity.filters as filter (filter.id)}
      <button
        aria-pressed={filter.active}
        class="activity-filter"
        data-action="activity-filter"
        data-filter={filter.id}
        on:click={() => applyFilter(filter.id)}
        type="button"
      >
        {filter.label}
        <span>{filter.countLabel}</span>
      </button>
    {/each}
  </div>
  <ol class="activity-list">
    {#each current.activity.events as event (event.id)}
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
          on:click={() => expand(event.id)}
          type="button"
        >
          <span class="activity-event__type">{event.typeLabel}</span>
          <strong>{event.actor} {event.action} {event.target}</strong>
          <time>{event.timeLabel}</time>
        </button>
        {#if event.expanded}
          <p class="activity-event__detail">{event.detail}</p>
        {/if}
      </li>
    {/each}
  </ol>
</main>
