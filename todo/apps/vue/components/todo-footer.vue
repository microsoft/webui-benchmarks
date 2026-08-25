<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  footer: { type: Object, required: true },
});
</script>

<template>
  <todo-footer data-component="todo-footer">
    <footer class="todo-footer">
      <span>{{ footer.label }}</span>
      <span>{{ footer.itemCountLabel }}</span>
      <span>{{ footer.variantLabel }}</span>
    </footer>
  </todo-footer>
</template>
