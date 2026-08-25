<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-list" });
defineProps({
  activeFilter: { type: String, required: true },
  todos: { type: Array, required: true },
});
defineEmits(["select", "toggle"]);

function isHidden(todo, activeFilter) {
  if (activeFilter === "pending") {
    return !todo.pending;
  }
  if (activeFilter === "completed") {
    return !todo.completed;
  }
  return false;
}
</script>

<template>
  <ul class="todo-list" aria-label="Todo items" role="listbox">
    <LazyTodoItem
      v-for="todo in todos"
      :key="todo.id"
      :hidden="isHidden(todo, activeFilter)"
      :hydrate-on-visible="{ rootMargin: '200px' }"
      :todo="todo"
      @select="$emit('select', $event)"
      @toggle="$emit('toggle', $event)"
    />
  </ul>
</template>
