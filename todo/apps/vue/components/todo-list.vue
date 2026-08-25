<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import { defineAsyncComponent, hydrateOnVisible } from "vue";
import TodoItem from "./todo-item.vue";

const LazyTodoItem = defineAsyncComponent({
  hydrate: hydrateOnVisible({ rootMargin: "200px" }),
  loader: () => Promise.resolve(TodoItem),
});

defineProps({
  todos: { type: Array, required: true },
});
defineEmits(["select", "toggle"]);
</script>

<template>
  <todo-list data-component="todo-list">
    <ul aria-label="Todo items" class="todo-list" role="listbox">
      <LazyTodoItem
        v-for="todo in todos"
        :key="todo.id"
        :todo="todo"
        @select="$emit('select', $event)"
        @toggle="$emit('toggle', $event)"
      />
    </ul>
  </todo-list>
</template>
