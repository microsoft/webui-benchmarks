// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const METRICS = [
  ["total", "Total", "totalCount", "totalLabel"],
  ["completed", "Completed", "completedCount", "completedLabel"],
  ["pending", "Pending", "pendingCount", "pendingLabel"],
  ["high-priority", "High priority", "highPriorityCount", "highPriorityLabel"],
  ["overdue", "Overdue", "overdueCount", "overdueLabel"],
];

export default function TodoSummary({ summary }) {
  return (
    <section className="todo-summary" aria-label="Todo summary">
      {METRICS.map(([id, label, countKey, labelKey]) => (
        <article
          className="todo-summary__metric"
          data-summary-metric={id}
          key={id}
        >
          <span>{label}</span>
          <strong>{summary[countKey]}</strong>
          <small>{summary[labelKey]}</small>
        </article>
      ))}
    </section>
  );
}
