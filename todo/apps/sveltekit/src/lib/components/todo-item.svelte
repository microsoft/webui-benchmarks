<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import TodoBadge from "./todo-badge.svelte";
  import TodoButton from "./todo-button.svelte";
  import TodoCheckbox from "./todo-checkbox.svelte";
  import TodoTagList from "./todo-tag-list.svelte";

  export let hidden;
  export let onSelect;
  export let onToggle;
  export let todo;
</script>

<li
  aria-selected={todo.selected}
  class="todo-item"
  data-selected={todo.selected ? "" : undefined}
  data-todo-id={todo.id}
  {hidden}
  role="option"
  style={hidden ? "display:none" : undefined}
>
  <TodoCheckbox {onToggle} {todo} />
  <div class="todo-item__content">
    <strong class="todo-item__title">{todo.title}</strong>
    <p class="todo-item__description">{todo.description}</p>
    <div class="todo-item__badges">
      {#if todo.completed}
        <TodoBadge branch="completed" label={todo.statusLabel} />
      {/if}
      {#if todo.pending}
        <TodoBadge branch="pending" label={todo.statusLabel} />
      {/if}
      {#if todo.isHighPriority}
        <TodoBadge branch="high-priority" label={todo.priorityLabel} />
      {/if}
      {#if todo.isMediumPriority}
        <TodoBadge branch="medium-priority" label={todo.priorityLabel} />
      {/if}
      {#if todo.overdue}
        <TodoBadge branch="overdue" label={todo.dueLabel} />
      {/if}
      {#if todo.dueToday}
        <TodoBadge branch="due-today" label={todo.dueLabel} />
      {/if}
      {#if todo.blocked}
        <TodoBadge branch="blocked" label={todo.blockedLabel} />
      {/if}
      {#if todo.recurring}
        <TodoBadge branch="recurring" label={todo.recurringLabel} />
      {/if}
      {#if todo.assigned}
        <TodoBadge branch="assigned" label={todo.assigneeLabel} />
      {/if}
      {#if todo.hasTags}
        <TodoBadge branch="has-tags" label={todo.tagCountLabel} />
      {/if}
      {#if todo.hasSubtasks}
        <TodoBadge
          branch="has-subtasks"
          label={todo.subtaskProgressLabel}
        />
      {/if}
      {#if todo.selected}
        <TodoBadge branch="selected" label={todo.selectionLabel} />
      {/if}
    </div>
    <TodoTagList {todo} />
  </div>
  <div class="todo-item__meta">
    <span>{todo.priorityLabel}</span>
    <span>{todo.dueLabel}</span>
    <span>{todo.assigneeLabel}</span>
    <span>{todo.subtaskCountLabel}</span>
    <TodoButton
      action="select"
      ariaLabel={`Select ${todo.title}`}
      label="Select"
      onAction={() => onSelect(todo.id)}
      pressed={todo.selected}
      todoId={todo.id}
    />
  </div>
</li>
