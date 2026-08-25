<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  export let todo;
</script>

<div class="todo-tag-list" aria-label={todo.tagCountLabel}>
  {#each todo.tags as tag (tag.id)}
    <span
      class="todo-tag"
      data-tag-id={tag.id}
      data-tone={tag.tone}
    >
      {tag.label}
    </span>
  {/each}
</div>
