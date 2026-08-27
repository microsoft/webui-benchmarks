<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# WebUI FAST V3 benchmark app

This product implements the same 13-component workspace contract, state variants,
component-scoped CSS, and Rust/Actix server as the WebUI Shadow DOM row. Its
self-contained source uses FAST-specific scalar component boundaries and
compiles a separate protocol with:

```js
{ css: "link", dom: "shadow", plugin: "fast-v3" }
```

Each component has its own `FASTElement` class and declarative template
registration. `todo-app` and `workspace-intelligence` own delegated interaction
behavior; the other eleven classes bind component-local inputs through
`observerMap()`. The browser row enables FAST hydration before registration and
runs the same 29-step interaction journey as every other product.
