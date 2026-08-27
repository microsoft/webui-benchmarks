<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import { onMounted, ref } from "vue";
import { BRANCHES } from "../../../shared/contract.mjs";
import { publishHydrated } from "../../../shared/hydration.mjs";
import { createWorkspaceIntelligence } from "../../../shared/workspace-intelligence.mjs";
import TodoFooter from "./todo-footer.vue";
import TodoHeader from "./todo-header.vue";
import TodoList from "./todo-list.vue";
import TodoSummary from "./todo-summary.vue";
import TodoToolbar from "./todo-toolbar.vue";
import WorkspaceIntelligence from "../../vue/components/workspace-intelligence.vue";

defineOptions({ name: "todo-app" });
const props = defineProps({
  initialState: { type: Object, required: true },
  renderMode: { type: String, required: true },
});

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function copyTodoState(source) {
  return {
    ...source,
    app: { ...source.app },
    branchCounts: { ...source.branchCounts },
    footer: { ...source.footer },
    selection: { ...source.selection },
    summary: { ...source.summary },
    toolbar: {
      ...source.toolbar,
      filters: source.toolbar.filters.map((filter) => ({ ...filter })),
    },
    todos: source.todos.map((todo) => ({
      ...todo,
      assignee: { ...todo.assignee },
      subtasks: todo.subtasks.map((subtask) => ({ ...subtask })),
      tags: todo.tags.map((tag) => ({ ...tag })),
    })),
  };
}

function refreshDerivedState(current, todos) {
  const branchCounts = Object.fromEntries(
    BRANCHES.map((branch) => [branch.id, 0]),
  );
  let tagCount = 0;
  let subtaskCount = 0;
  for (const todo of todos) {
    tagCount += todo.tags.length;
    subtaskCount += todo.subtasks.length;
    for (const branch of BRANCHES) {
      if (todo[branch.condition.field]) {
        branchCounts[branch.id] += 1;
      }
    }
  }

  const completedCount = branchCounts.completed;
  const pendingCount = branchCounts.pending;
  const highPriorityCount = branchCounts["high-priority"];
  const overdueCount = branchCounts.overdue;
  const selectedTodo = todos.find((todo) => todo.selected);
  const totalCount = todos.length;

  return {
    ...current,
    branchCounts,
    footer: {
      ...current.footer,
      itemCountLabel: plural(totalCount, "item"),
    },
    intelligence: createWorkspaceIntelligence(todos, current.intelligence),
    selection: {
      todoId: selectedTodo?.id ?? "",
      label: selectedTodo ? `Selected ${selectedTodo.id}` : "No todo selected",
      hasSelection: selectedTodo !== undefined,
    },
    summary: {
      ...current.summary,
      totalCount,
      completedCount,
      pendingCount,
      highPriorityCount,
      overdueCount,
      selectedCount: branchCounts.selected,
      tagCount,
      subtaskCount,
      totalLabel: plural(totalCount, "item"),
      completedLabel: plural(completedCount, "completed item"),
      pendingLabel: plural(pendingCount, "pending item"),
      highPriorityLabel: plural(highPriorityCount, "high priority item"),
      overdueLabel: plural(overdueCount, "overdue item"),
    },
    toolbar: {
      ...current.toolbar,
      hasCompleted: completedCount > 0,
      filters: current.toolbar.filters.map((filter) => {
        const count = filter.id === "all"
          ? totalCount
          : filter.id === "pending"
            ? pendingCount
            : completedCount;
        return { ...filter, count, countLabel: String(count) };
      }),
    },
    todos,
  };
}

const state = ref(copyTodoState(props.initialState));
onMounted(() => {
  publishHydrated("nuxt");
});

function filterTodos(filterId) {
  state.value = {
    ...state.value,
    toolbar: {
      ...state.value.toolbar,
      activeFilter: filterId,
      filters: state.value.toolbar.filters.map((filter) => ({
        ...filter,
        active: filter.id === filterId,
      })),
    },
  };
}

function selectTodo(todoId) {
  const todos = state.value.todos.map((todo) => {
    const selected = todo.id === todoId;
    return {
      ...todo,
      selected,
      selectionLabel: selected ? "Selected" : "Not selected",
    };
  });
  state.value = refreshDerivedState(state.value, todos);
}

function toggleTodo(todoId) {
  const todos = state.value.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }
    const completed = !todo.completed;
    return {
      ...todo,
      completed,
      pending: !completed,
      statusLabel: completed ? "Completed" : "Pending",
    };
  });
  state.value = refreshDerivedState(state.value, todos);
}

function clearCompleted() {
  const remaining = state.value.todos.filter((todo) => !todo.completed);
  const selectedId = remaining.find((todo) => todo.selected)?.id
    ?? remaining[0]?.id;
  const todos = remaining.map((todo) => {
    const selected = todo.id === selectedId;
    return {
      ...todo,
      selected,
      selectionLabel: selected ? "Selected" : "Not selected",
    };
  });
  state.value = refreshDerivedState(state.value, todos);
}
</script>

<template>
  <main
    class="todo-app"
    data-route-page="work"
    :data-render-mode="renderMode"
    :data-variant-id="state.variantId"
  >
    <TodoHeader :app="state.app" :variant-label="state.variantLabel" />
    <TodoSummary :summary="state.summary" />
    <WorkspaceIntelligence
      :state="state"
      @state-change="state = $event"
    />
    <TodoToolbar
      :selection="state.selection"
      :toolbar="state.toolbar"
      @clear-completed="clearCompleted"
      @filter="filterTodos"
    />
    <TodoList
      :active-filter="state.toolbar.activeFilter"
      :todos="state.todos"
      @select="selectTodo"
      @toggle="toggleTodo"
    />
    <TodoFooter :footer="state.footer" />
  </main>
</template>
