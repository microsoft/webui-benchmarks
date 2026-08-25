<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-tag-list" });
defineProps({
  todo: { type: Object, required: true },
});
</script>

<template>
  <div class="todo-tag-list" :aria-label="todo.tagCountLabel">
    <span
      v-for="tag in todo.tags"
      :key="tag.id"
      class="todo-tag"
      :data-tag-id="tag.id"
      :data-tone="tag.tone"
    >
      {{ tag.label }}
    </span>
  </div>
</template>
