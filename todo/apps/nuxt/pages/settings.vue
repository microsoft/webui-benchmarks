<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import SettingsPage from "../../vue/components/settings-page.vue";

const { data: initialState, error } = await useFetch("/api/route-state", {
  key: "settings-route-state",
});
if (error.value !== undefined && error.value !== null) {
  throw createError({
    cause: error.value,
    statusCode: 500,
    statusMessage: "Settings route state failed",
  });
}

useHead({
  title: "Settings · SSR Todo Benchmark",
});
</script>

<template>
  <SettingsPage :state="initialState" />
</template>
