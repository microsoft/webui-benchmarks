<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-badge" });
defineProps({
  branch: { type: String, required: true },
  label: { type: String, required: true },
});
</script>

<template>
  <span class="todo-badge" :data-branch="branch">{{ label }}</span>
</template>
