<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import { computed, onMounted, shallowRef } from "vue";
import { publishHydrated } from "../../../shared/hydration.mjs";
import {
  clearCompletedTodos,
  filterTodos,
  selectTodo,
  toggleTodoCompletion,
  visibleTodos,
} from "../interactions.mjs";
import TodoFooter from "./todo-footer.vue";
import TodoHeader from "./todo-header.vue";
import TodoList from "./todo-list.vue";
import TodoSummary from "./todo-summary.vue";
import TodoToolbar from "./todo-toolbar.vue";
import WorkspaceIntelligence from "./workspace-intelligence.vue";

const props = defineProps({
  state: { type: Object, required: true },
});

const current = shallowRef(props.state);
const visible = computed(() => visibleTodos(current.value));
onMounted(() => {
  publishHydrated("vue");
});

function applyFilter(filterId) {
  current.value = filterTodos(current.value, filterId);
}

function select(todoId) {
  current.value = selectTodo(current.value, todoId);
}

function toggle(todoId) {
  current.value = toggleTodoCompletion(current.value, todoId);
}

function clearCompleted() {
  current.value = clearCompletedTodos(current.value);
}
</script>

<template>
  <todo-app data-component="todo-app" :data-variant-id="current.variantId">
    <main
      aria-labelledby="todo-app-title"
      class="todo-app"
      data-route-page="work"
    >
      <TodoHeader :app="current.app" :variant-label="current.variantLabel" />
      <TodoSummary :summary="current.summary" />
      <WorkspaceIntelligence
        :state="current"
        @state-change="current = $event"
      />
      <TodoToolbar
        :selection="current.selection"
        :toolbar="current.toolbar"
        @clear-completed="clearCompleted"
        @filter="applyFilter"
      />
      <TodoList :todos="visible" @select="select" @toggle="toggle" />
      <TodoFooter :footer="current.footer" />
    </main>
  </todo-app>
</template>
