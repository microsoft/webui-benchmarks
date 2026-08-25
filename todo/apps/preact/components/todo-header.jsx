// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function TodoHeader({ app, variantLabel }) {
  return (
    <todo-header data-component="todo-header">
      <header class="todo-header">
        <div>
          <p class="todo-header__eyebrow">{app.eyebrow}</p>
          <h1 id="todo-app-title">{app.title}</h1>
          <p>
            <strong>{app.subtitle}</strong>
          </p>
          <p>{app.description}</p>
        </div>
        <strong>{variantLabel}</strong>
      </header>
    </todo-header>
  );
}
