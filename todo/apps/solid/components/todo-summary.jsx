// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoSummary(props) {
  return (
    <todo-summary data-component="todo-summary">
      <section aria-label="Todo summary" class="todo-summary">
        <article class="todo-summary__metric">
          <span>Total</span>
          <strong>{props.summary.totalCount}</strong>
          <small>{props.summary.totalLabel}</small>
        </article>
        <article class="todo-summary__metric">
          <span>Completed</span>
          <strong>{props.summary.completedCount}</strong>
          <small>{props.summary.completedLabel}</small>
        </article>
        <article class="todo-summary__metric">
          <span>Pending</span>
          <strong>{props.summary.pendingCount}</strong>
          <small>{props.summary.pendingLabel}</small>
        </article>
        <article class="todo-summary__metric">
          <span>High priority</span>
          <strong>{props.summary.highPriorityCount}</strong>
          <small>{props.summary.highPriorityLabel}</small>
        </article>
        <article class="todo-summary__metric">
          <span>Overdue</span>
          <strong>{props.summary.overdueCount}</strong>
          <small>{props.summary.overdueLabel}</small>
        </article>
      </section>
    </todo-summary>
  );
}
