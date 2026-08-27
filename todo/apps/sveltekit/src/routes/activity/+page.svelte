<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import ActivityPage from "$lib/components/activity-page.svelte";
  export let data;
</script>

<svelte:head>
  <title>Activity · SSR Todo Benchmark</title>
</svelte:head>

<ActivityPage state={data.initialState} />
