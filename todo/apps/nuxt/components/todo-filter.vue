<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-filter" });
defineProps({
  filter: { type: Object, required: true },
});
defineEmits(["filter"]);
</script>

<template>
  <button
    :aria-pressed="filter.active"
    class="todo-filter"
    data-action="filter"
    :data-active="filter.active ? '' : undefined"
    :data-filter="filter.id"
    type="button"
    @click="$emit('filter', filter.id)"
  >
    <span>{{ filter.label }}</span>
    <span class="todo-filter__count">{{ filter.countLabel }}</span>
  </button>
</template>
