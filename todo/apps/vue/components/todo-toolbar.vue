<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import TodoButton from "./todo-button.vue";
import TodoFilter from "./todo-filter.vue";

defineProps({
  selection: { type: Object, required: true },
  toolbar: { type: Object, required: true },
});
defineEmits(["clear-completed", "filter"]);
</script>

<template>
  <todo-toolbar data-component="todo-toolbar">
    <section aria-label="Todo controls" class="todo-toolbar">
      <div aria-label="Filter todos" class="todo-toolbar__filters" role="group">
        <TodoFilter
          v-for="filter in toolbar.filters"
          :key="filter.id"
          :filter="filter"
          @filter="$emit('filter', $event)"
        />
      </div>
      <span
        aria-live="polite"
        class="todo-toolbar__selection"
      >{{ selection.label }}</span>
      <TodoButton
        action="clear-completed"
        :aria-label="toolbar.clearCompletedLabel"
        :disabled="!toolbar.hasCompleted"
        :label="toolbar.clearCompletedLabel"
        @action="$emit('clear-completed')"
      />
    </section>
  </todo-toolbar>
</template>
