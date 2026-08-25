<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import TodoButton from "./todo-button.svelte";
  import TodoFilter from "./todo-filter.svelte";

  export let onClearCompleted;
  export let onFilter;
  export let selection;
  export let toolbar;
</script>

<section class="todo-toolbar" aria-label="Todo controls">
  <div
    class="todo-toolbar__filters"
    role="group"
    aria-label="Filter todos"
  >
    {#each toolbar.filters as filter (filter.id)}
      <TodoFilter {filter} {onFilter} />
    {/each}
  </div>
  <span class="todo-toolbar__selection" aria-live="polite">
    {selection.label}
  </span>
  <TodoButton
    action="clear-completed"
    ariaLabel={toolbar.clearCompletedLabel}
    disabled={!toolbar.hasCompleted}
    label={toolbar.clearCompletedLabel}
    onAction={onClearCompleted}
  />
</section>
