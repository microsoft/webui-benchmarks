<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import TodoBadge from "./todo-badge.vue";
import TodoButton from "./todo-button.vue";
import TodoCheckbox from "./todo-checkbox.vue";
import TodoTagList from "./todo-tag-list.vue";

defineOptions({ name: "todo-item" });
defineProps({
  hidden: { type: Boolean, required: true },
  todo: { type: Object, required: true },
});
defineEmits(["select", "toggle"]);
</script>

<template>
  <li
    :aria-selected="todo.selected"
    class="todo-item"
    :data-selected="todo.selected ? '' : undefined"
    :data-todo-id="todo.id"
    :hidden="hidden"
    role="option"
    :style="hidden ? { display: 'none' } : undefined"
  >
    <TodoCheckbox :todo="todo" @toggle="$emit('toggle', $event)" />
    <div class="todo-item__content">
      <strong class="todo-item__title">{{ todo.title }}</strong>
      <p class="todo-item__description">{{ todo.description }}</p>
      <div class="todo-item__badges">
        <TodoBadge
          v-if="todo.completed"
          branch="completed"
          :label="todo.statusLabel"
        />
        <TodoBadge
          v-if="todo.pending"
          branch="pending"
          :label="todo.statusLabel"
        />
        <TodoBadge
          v-if="todo.isHighPriority"
          branch="high-priority"
          :label="todo.priorityLabel"
        />
        <TodoBadge
          v-if="todo.isMediumPriority"
          branch="medium-priority"
          :label="todo.priorityLabel"
        />
        <TodoBadge
          v-if="todo.overdue"
          branch="overdue"
          :label="todo.dueLabel"
        />
        <TodoBadge
          v-if="todo.dueToday"
          branch="due-today"
          :label="todo.dueLabel"
        />
        <TodoBadge
          v-if="todo.blocked"
          branch="blocked"
          :label="todo.blockedLabel"
        />
        <TodoBadge
          v-if="todo.recurring"
          branch="recurring"
          :label="todo.recurringLabel"
        />
        <TodoBadge
          v-if="todo.assigned"
          branch="assigned"
          :label="todo.assigneeLabel"
        />
        <TodoBadge
          v-if="todo.hasTags"
          branch="has-tags"
          :label="todo.tagCountLabel"
        />
        <TodoBadge
          v-if="todo.hasSubtasks"
          branch="has-subtasks"
          :label="todo.subtaskProgressLabel"
        />
        <TodoBadge
          v-if="todo.selected"
          branch="selected"
          :label="todo.selectionLabel"
        />
      </div>
      <TodoTagList :todo="todo" />
    </div>
    <div class="todo-item__meta">
      <span>{{ todo.priorityLabel }}</span>
      <span>{{ todo.dueLabel }}</span>
      <span>{{ todo.assigneeLabel }}</span>
      <span>{{ todo.subtaskCountLabel }}</span>
      <TodoButton
        action="select"
        :aria-label="`Select ${todo.title}`"
        label="Select"
        :pressed="todo.selected"
        :todo-id="todo.id"
        @action="$emit('select', todo.id)"
      />
    </div>
  </li>
</template>
