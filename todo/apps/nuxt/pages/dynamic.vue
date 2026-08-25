<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import TodoApp from "../components/todo-app.vue";

const initialState = useState("todo-dynamic-state", () => null);

if (import.meta.server) {
  const { nextDynamicTodoState } = await import("../lib/server-state.mjs");
  initialState.value = nextDynamicTodoState();
}

useHead({
  title: "Dynamic SSR · SSR Todo Benchmark",
});
</script>

<template>
  <TodoApp :initial-state="initialState" render-mode="dynamic" />
</template>
