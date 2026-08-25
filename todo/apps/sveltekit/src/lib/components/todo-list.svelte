<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import TodoItem from "./todo-item.svelte";

  export let activeFilter;
  export let onSelect;
  export let onToggle;
  export let todos;

  function isHidden(todo) {
    if (activeFilter === "pending") {
      return !todo.pending;
    }
    if (activeFilter === "completed") {
      return !todo.completed;
    }
    return false;
  }
</script>

<ul class="todo-list" aria-label="Todo items" role="listbox">
  {#each todos as todo (todo.id)}
    <TodoItem
      hidden={isHidden(todo)}
      {onSelect}
      {onToggle}
      {todo}
    />
  {/each}
</ul>
