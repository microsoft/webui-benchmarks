<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineOptions({ name: "todo-summary" });
defineProps({
  summary: { type: Object, required: true },
});
</script>

<template>
  <section class="todo-summary" aria-label="Todo summary">
    <article class="todo-summary__metric" data-summary-metric="total">
      <span>Total</span>
      <strong>{{ summary.totalCount }}</strong>
      <small>{{ summary.totalLabel }}</small>
    </article>
    <article class="todo-summary__metric" data-summary-metric="completed">
      <span>Completed</span>
      <strong>{{ summary.completedCount }}</strong>
      <small>{{ summary.completedLabel }}</small>
    </article>
    <article class="todo-summary__metric" data-summary-metric="pending">
      <span>Pending</span>
      <strong>{{ summary.pendingCount }}</strong>
      <small>{{ summary.pendingLabel }}</small>
    </article>
    <article class="todo-summary__metric" data-summary-metric="high-priority">
      <span>High priority</span>
      <strong>{{ summary.highPriorityCount }}</strong>
      <small>{{ summary.highPriorityLabel }}</small>
    </article>
    <article class="todo-summary__metric" data-summary-metric="overdue">
      <span>Overdue</span>
      <strong>{{ summary.overdueCount }}</strong>
      <small>{{ summary.overdueLabel }}</small>
    </article>
  </section>
</template>
