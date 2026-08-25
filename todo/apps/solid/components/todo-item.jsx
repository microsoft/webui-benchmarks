// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Show } from "solid-js";
import { TodoBadge } from "./todo-badge.jsx";
import { TodoButton } from "./todo-button.jsx";
import { TodoCheckbox } from "./todo-checkbox.jsx";
import { TodoTagList } from "./todo-tag-list.jsx";

export function TodoItem(props) {
  return (
    <todo-item data-component="todo-item">
      <li
        aria-selected={String(props.todo.selected)}
        class="todo-item"
        data-selected={props.todo.selected || undefined}
        data-todo-id={props.todo.id}
        role="option"
        tabindex="0"
      >
        <TodoCheckbox todo={props.todo} onToggle={props.onToggle} />
        <div class="todo-item__content">
          <strong class="todo-item__title">{props.todo.title}</strong>
          <span class="todo-item__description">{props.todo.description}</span>
          <div aria-label="Todo attributes" class="todo-item__badges">
            <Show when={props.todo.completed}>
              <TodoBadge branch="completed" label={props.todo.statusLabel} />
            </Show>
            <Show when={props.todo.pending}>
              <TodoBadge branch="pending" label={props.todo.statusLabel} />
            </Show>
            <Show when={props.todo.isHighPriority}>
              <TodoBadge
                branch="high-priority"
                label={props.todo.priorityLabel}
              />
            </Show>
            <Show when={props.todo.isMediumPriority}>
              <TodoBadge
                branch="medium-priority"
                label={props.todo.priorityLabel}
              />
            </Show>
            <Show when={props.todo.overdue}>
              <TodoBadge branch="overdue" label={props.todo.dueLabel} />
            </Show>
            <Show when={props.todo.dueToday}>
              <TodoBadge branch="due-today" label={props.todo.dueLabel} />
            </Show>
            <Show when={props.todo.blocked}>
              <TodoBadge branch="blocked" label={props.todo.blockedLabel} />
            </Show>
            <Show when={props.todo.recurring}>
              <TodoBadge
                branch="recurring"
                label={props.todo.recurringLabel}
              />
            </Show>
            <Show when={props.todo.assigned}>
              <TodoBadge branch="assigned" label={props.todo.assigneeLabel} />
            </Show>
            <Show when={props.todo.hasTags}>
              <TodoBadge branch="has-tags" label={props.todo.tagCountLabel} />
            </Show>
            <Show when={props.todo.hasSubtasks}>
              <TodoBadge
                branch="has-subtasks"
                label={props.todo.subtaskProgressLabel}
              />
            </Show>
            <Show when={props.todo.selected}>
              <TodoBadge branch="selected" label={props.todo.selectionLabel} />
            </Show>
          </div>
          <TodoTagList todo={props.todo} />
        </div>
        <div class="todo-item__meta">
          <span>{props.todo.priorityLabel}</span>
          <span>{props.todo.dueLabel}</span>
          <span>{props.todo.assigneeLabel}</span>
          <span>{props.todo.subtaskCountLabel}</span>
          <TodoButton
            action="select"
            ariaLabel={`Select ${props.todo.title}`}
            label="Select"
            onAction={() => props.onSelect(props.todo.id)}
            pressed={props.todo.selected}
            todoId={props.todo.id}
          />
        </div>
      </li>
    </todo-item>
  );
}
