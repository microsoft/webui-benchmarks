<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import SettingsPage from "#lib/components/settings-page.svelte";
  export let data;
</script>

<svelte:head>
  <title>Settings · SSR Todo Benchmark</title>
</svelte:head>

<SettingsPage state={data.initialState} />
