<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  summary: { type: Object, required: true },
});
</script>

<template>
  <todo-summary data-component="todo-summary">
    <section aria-label="Todo summary" class="todo-summary">
      <article class="todo-summary__metric">
        <span>Total</span><strong>{{ summary.totalCount }}</strong><small>{{ summary.totalLabel }}</small>
      </article>
      <article class="todo-summary__metric">
        <span>Completed</span><strong>{{ summary.completedCount }}</strong><small>{{ summary.completedLabel }}</small>
      </article>
      <article class="todo-summary__metric">
        <span>Pending</span><strong>{{ summary.pendingCount }}</strong><small>{{ summary.pendingLabel }}</small>
      </article>
      <article class="todo-summary__metric">
        <span>High priority</span><strong>{{ summary.highPriorityCount }}</strong><small>{{ summary.highPriorityLabel }}</small>
      </article>
      <article class="todo-summary__metric">
        <span>Overdue</span><strong>{{ summary.overdueCount }}</strong><small>{{ summary.overdueLabel }}</small>
      </article>
    </section>
  </todo-summary>
</template>
