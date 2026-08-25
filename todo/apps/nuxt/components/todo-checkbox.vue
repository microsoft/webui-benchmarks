<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-checkbox" });
defineProps({
  todo: { type: Object, required: true },
});
defineEmits(["toggle"]);
</script>

<template>
  <input
    :aria-label="`Toggle completion for ${todo.title}`"
    :checked="todo.completed"
    class="todo-checkbox"
    data-action="toggle-completion"
    :data-todo-id="todo.id"
    type="checkbox"
    @change="$emit('toggle', todo.id)"
  >
</template>
