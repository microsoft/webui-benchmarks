<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  filter: { type: Object, required: true },
});
defineEmits(["filter"]);
</script>

<template>
  <todo-filter data-component="todo-filter">
    <button
      :aria-label="`${filter.label}: ${filter.countLabel}`"
      :aria-pressed="String(filter.active)"
      class="todo-filter"
      data-action="filter"
      :data-active="filter.active || undefined"
      :data-filter="filter.id"
      type="button"
      @click="$emit('filter', filter.id)"
    >
      <span>{{ filter.label }}</span>
      <span class="todo-filter__count">{{ filter.countLabel }}</span>
    </button>
  </todo-filter>
</template>
