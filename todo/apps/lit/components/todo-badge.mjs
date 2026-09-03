// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { LitElement, html } from "lit";
import { todoBadge } from "../component-styles.mjs";

/**
 * The Shadow DOM host owns the badge markup and label at each branch site; the
 * label arrives as light-DOM child content, so a slot surfaces it.
 */
export class TodoBadge extends LitElement {
  static styles = todoBadge;

  render() {
    return html`<slot></slot>`;
  }
}

customElements.define("todo-badge", TodoBadge);
