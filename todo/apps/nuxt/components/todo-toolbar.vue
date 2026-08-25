<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import TodoButton from "./todo-button.vue";
import TodoFilter from "./todo-filter.vue";

defineOptions({ name: "todo-toolbar" });
defineProps({
  selection: { type: Object, required: true },
  toolbar: { type: Object, required: true },
});
defineEmits(["clear-completed", "filter"]);
</script>

<template>
  <section class="todo-toolbar" aria-label="Todo controls">
    <div
      class="todo-toolbar__filters"
      role="group"
      aria-label="Filter todos"
    >
      <TodoFilter
        v-for="filter in toolbar.filters"
        :key="filter.id"
        :filter="filter"
        @filter="$emit('filter', $event)"
      />
    </div>
    <span class="todo-toolbar__selection" aria-live="polite">
      {{ selection.label }}
    </span>
    <TodoButton
      action="clear-completed"
      :aria-label="toolbar.clearCompletedLabel"
      :disabled="!toolbar.hasCompleted"
      :label="toolbar.clearCompletedLabel"
      @action="$emit('clear-completed')"
    />
  </section>
</template>
