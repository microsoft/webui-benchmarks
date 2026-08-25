<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-footer" });
defineProps({
  footer: { type: Object, required: true },
});
</script>

<template>
  <footer class="todo-footer">
    <span>{{ footer.label }}</span>
    <span>
      <span data-footer-count>{{ footer.itemCountLabel }}</span>
      ·
      {{ footer.variantLabel }}
    </span>
  </footer>
</template>
