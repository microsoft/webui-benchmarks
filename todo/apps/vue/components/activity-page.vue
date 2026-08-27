<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import { onMounted, ref, shallowRef } from "vue";
import {
  filterActivity,
  markActivityRead,
  toggleActivityDetail,
} from "../../../shared/workspace-interactions.mjs";

const props = defineProps({
  state: { type: Object, required: true },
});
const current = shallowRef(props.state);
const routeReady = ref(false);
onMounted(() => {
  routeReady.value = true;
});

function applyFilter(filterId) {
  current.value = filterActivity(current.value, filterId);
}

function expand(eventId) {
  current.value = toggleActivityDetail(current.value, eventId);
}

function markRead() {
  current.value = markActivityRead(current.value);
}
</script>

<template>
  <main
    class="workspace-page activity-page"
    data-route-page="activity"
    :data-route-ready="routeReady || undefined"
  >
    <header class="workspace-page__header">
      <div>
        <h1>{{ current.activity.title }}</h1>
        <p>{{ current.activity.description }}</p>
      </div>
      <button
        class="workspace-action"
        data-action="activity-mark-read"
        :disabled="current.activity.unreadCount === 0"
        type="button"
        @click="markRead"
      >
        Mark all read
        <span>{{ current.activity.unreadLabel }}</span>
      </button>
    </header>
    <div class="activity-filters" aria-label="Activity filters">
      <button
        v-for="filter in current.activity.filters"
        :key="filter.id"
        :aria-pressed="filter.active"
        class="activity-filter"
        data-action="activity-filter"
        :data-filter="filter.id"
        type="button"
        @click="applyFilter(filter.id)"
      >
        {{ filter.label }}
        <span>{{ filter.countLabel }}</span>
      </button>
    </div>
    <ol class="activity-list">
      <li
        v-for="event in current.activity.events"
        :key="event.id"
        class="activity-event"
        :data-event-id="event.id"
        :data-unread="event.unread || undefined"
        :hidden="!event.visible"
      >
        <button
          :aria-expanded="event.expanded"
          class="activity-event__toggle"
          data-action="activity-expand"
          :data-event-id="event.id"
          type="button"
          @click="expand(event.id)"
        >
          <span class="activity-event__type">{{ event.typeLabel }}</span>
          <strong>{{ event.actor }} {{ event.action }} {{ event.target }}</strong>
          <time>{{ event.timeLabel }}</time>
        </button>
        <p v-if="event.expanded" class="activity-event__detail">
          {{ event.detail }}
        </p>
      </li>
    </ol>
  </main>
</template>
