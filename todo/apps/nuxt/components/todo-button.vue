<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-button" });
defineProps({
  action: { type: String, required: true },
  ariaLabel: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  label: { type: String, required: true },
  pressed: { type: Boolean, default: undefined },
  todoId: { type: String, default: undefined },
});
defineEmits(["action"]);
</script>

<template>
  <button
    :aria-label="ariaLabel"
    :aria-pressed="pressed"
    class="todo-button"
    :data-action="action"
    :data-todo-id="todoId"
    :disabled="disabled"
    type="button"
    @click="$emit('action')"
  >
    {{ label }}
  </button>
</template>
