<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import TodoApp from "../components/todo-app.vue";

const initialState = useState("todo-cached-state", () => null);

if (import.meta.server) {
  const { CACHED_TODO_STATE } = await import("../lib/server-state.mjs");
  initialState.value = CACHED_TODO_STATE;
}

useHead({
  title: "Static cached response · SSR Todo Benchmark",
});
</script>

<template>
  <TodoApp :initial-state="initialState" render-mode="cached" />
</template>
