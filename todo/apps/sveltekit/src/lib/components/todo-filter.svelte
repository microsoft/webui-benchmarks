<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  export let filter;
  export let onFilter;
</script>

<button
  aria-pressed={filter.active}
  class="todo-filter"
  data-action="filter"
  data-active={filter.active ? "" : undefined}
  data-filter={filter.id}
  onclick={() => onFilter(filter.id)}
  type="button"
>
  <span>{filter.label}</span>
  <span class="todo-filter__count">{filter.countLabel}</span>
</button>
