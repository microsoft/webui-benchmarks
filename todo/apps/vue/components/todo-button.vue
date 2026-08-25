<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  action: { type: String, required: true },
  ariaLabel: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  label: { type: String, required: true },
  pressed: { default: undefined },
  todoId: { type: String, default: undefined },
});
defineEmits(["action"]);
</script>

<template>
  <todo-button data-component="todo-button">
    <button
      :aria-label="ariaLabel"
      :aria-pressed="pressed === undefined ? undefined : String(pressed)"
      class="todo-button"
      :data-action="action"
      :data-todo-id="todoId"
      :disabled="disabled"
      type="button"
      @click="$emit('action')"
    >{{ label }}</button>
  </todo-button>
</template>
