<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import TodoApp from "#lib/components/todo-app.svelte";

  export let data;
</script>

<svelte:head>
  <title>Static cached response · SSR Todo Benchmark</title>
</svelte:head>

<TodoApp initialState={data.initialState} renderMode="cached" />
