// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export default function TodoHeader({ app, variantLabel }) {
  return (
    <header className="todo-header">
      <div>
        <p className="todo-header__eyebrow">{app.eyebrow}</p>
        <h1 id="todo-app-title">{app.title}</h1>
        <p><strong>{app.subtitle}</strong></p>
        <p>{app.description}</p>
      </div>
      <strong>{variantLabel}</strong>
    </header>
  );
}
