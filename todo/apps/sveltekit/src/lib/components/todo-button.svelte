<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  export let action;
  export let ariaLabel;
  export let disabled = false;
  export let label;
  export let onAction;
  export let pressed = undefined;
  export let todoId = undefined;
</script>

<button
  aria-label={ariaLabel}
  aria-pressed={pressed}
  class="todo-button"
  data-action={action}
  data-todo-id={todoId}
  {disabled}
  onclick={onAction}
  type="button"
>
  {label}
</button>
