<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  todo: { type: Object, required: true },
});
defineEmits(["toggle"]);
</script>

<template>
  <todo-checkbox data-component="todo-checkbox">
    <input
      :aria-label="`${todo.statusLabel}: ${todo.title}`"
      :checked="todo.completed"
      class="todo-checkbox"
      data-action="toggle-completion"
      :data-todo-id="todo.id"
      type="checkbox"
      @change="$emit('toggle', todo.id)"
      @click.stop
    >
  </todo-checkbox>
</template>
