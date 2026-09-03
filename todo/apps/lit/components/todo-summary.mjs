// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoSummary } from "../component-styles.mjs";

export class TodoSummary extends LitElement {
  static properties = {
    totalcount: {},
    totallabel: {},
    completedcount: {},
    completedlabel: {},
    pendingcount: {},
    pendinglabel: {},
    highprioritycount: {},
    highprioritylabel: {},
    overduecount: {},
    overduelabel: {},
  };

  static styles = todoSummary;

  constructor() {
    super();
    this.totalcount = "";
    this.totallabel = "";
    this.completedcount = "";
    this.completedlabel = "";
    this.pendingcount = "";
    this.pendinglabel = "";
    this.highprioritycount = "";
    this.highprioritylabel = "";
    this.overduecount = "";
    this.overduelabel = "";
  }

  render() {
    return html`<section aria-label="Todo summary" class="todo-summary">
      <article class="todo-summary__metric">
        <span>Total</span>
        <strong>${this.totalcount}</strong>
        <small>${this.totallabel}</small>
      </article>
      <article class="todo-summary__metric">
        <span>Completed</span>
        <strong>${this.completedcount}</strong>
        <small>${this.completedlabel}</small>
      </article>
      <article class="todo-summary__metric">
        <span>Pending</span>
        <strong>${this.pendingcount}</strong>
        <small>${this.pendinglabel}</small>
      </article>
      <article class="todo-summary__metric">
        <span>High priority</span>
        <strong>${this.highprioritycount}</strong>
        <small>${this.highprioritylabel}</small>
      </article>
      <article class="todo-summary__metric">
        <span>Overdue</span>
        <strong>${this.overduecount}</strong>
        <small>${this.overduelabel}</small>
      </article>
    </section>`;
  }
}

customElements.define("todo-summary", TodoSummary);
