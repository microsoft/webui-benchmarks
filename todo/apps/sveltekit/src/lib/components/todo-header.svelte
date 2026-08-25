<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  export let app;
  export let variantLabel;
</script>

<header class="todo-header">
  <div>
    <p class="todo-header__eyebrow">{app.eyebrow}</p>
    <h1 id="todo-app-title">{app.title}</h1>
    <p><strong>{app.subtitle}</strong></p>
    <p>{app.description}</p>
  </div>
  <strong>{variantLabel}</strong>
</header>
