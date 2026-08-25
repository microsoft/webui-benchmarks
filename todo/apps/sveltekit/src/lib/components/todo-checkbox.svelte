<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  export let onToggle;
  export let todo;
</script>

<input
  aria-label={`Toggle completion for ${todo.title}`}
  checked={todo.completed}
  class="todo-checkbox"
  data-action="toggle-completion"
  data-todo-id={todo.id}
  onchange={() => onToggle(todo.id)}
  type="checkbox"
>
