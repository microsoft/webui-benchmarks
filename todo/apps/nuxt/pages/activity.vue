<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import ActivityPage from "../../vue/components/activity-page.vue";

const { data: initialState, error } = await useFetch("/api/route-state", {
  key: "activity-route-state",
});
if (error.value !== undefined && error.value !== null) {
  throw createError({
    cause: error.value,
    statusCode: 500,
    statusMessage: "Activity route state failed",
  });
}

useHead({
  title: "Activity · SSR Todo Benchmark",
});
</script>

<template>
  <ActivityPage :state="initialState" />
</template>
