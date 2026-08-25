// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoHeader(props) {
  return (
    <todo-header data-component="todo-header">
      <header class="todo-header">
        <div>
          <p class="todo-header__eyebrow">{props.app.eyebrow}</p>
          <h1 id="todo-app-title">{props.app.title}</h1>
          <p><strong>{props.app.subtitle}</strong></p>
          <p>{props.app.description}</p>
        </div>
        <strong>{props.variantLabel}</strong>
      </header>
    </todo-header>
  );
}
