<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-header" });
defineProps({
  app: { type: Object, required: true },
  variantLabel: { type: String, required: true },
});
</script>

<template>
  <header class="todo-header">
    <div>
      <p class="todo-header__eyebrow">{{ app.eyebrow }}</p>
      <h1 id="todo-app-title">{{ app.title }}</h1>
      <p><strong>{{ app.subtitle }}</strong></p>
      <p>{{ app.description }}</p>
    </div>
    <strong>{{ variantLabel }}</strong>
  </header>
</template>
