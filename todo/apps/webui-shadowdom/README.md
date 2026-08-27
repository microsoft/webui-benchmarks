<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# WebUI Shadow DOM benchmark app

This product reuses the exact WebUI todo templates, TypeScript, projected state,
and Rust/Actix server as the Light DOM row. Its build copies the generated source,
applies component-scoped CSS, and compiles a separate protocol with:

```js
{ css: "module", dom: "shadow", plugin: "webui" }
```

The browser row verifies more than 800 open shadow roots (the exact count varies
with conditional state) and the same 29-step interaction journey. Keeping
application logic and transport fixed isolates DOM strategy.
