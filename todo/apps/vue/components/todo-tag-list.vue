<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  todo: { type: Object, required: true },
});
</script>

<template>
  <todo-tag-list data-component="todo-tag-list">
    <div :aria-label="todo.tagCountLabel" class="todo-tag-list">
      <span
        v-for="tag in todo.tags"
        :key="tag.id"
        class="todo-tag"
        :data-tag-id="tag.id"
        :data-tone="tag.tone"
      >{{ tag.label }}</span>
    </div>
  </todo-tag-list>
</template>
