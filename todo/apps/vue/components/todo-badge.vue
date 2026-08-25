<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  branch: { type: String, required: true },
  label: { type: String, required: true },
});
</script>

<template>
  <todo-badge
    class="todo-badge"
    :data-branch="branch"
    data-component="todo-badge"
  >{{ label }}</todo-badge>
</template>
