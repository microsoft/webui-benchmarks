<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
defineProps({
  state: { type: Object, required: true },
});
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-nav">
      <RouterLink class="workspace-brand" to="/dynamic">
        <span class="workspace-brand__mark" aria-hidden="true">W</span>
        <span>
          <strong>Workstream</strong>
          <small>Migration benchmark</small>
        </span>
      </RouterLink>
      <nav aria-label="Workspace">
        <RouterLink data-route-link="work" to="/dynamic">Work queue</RouterLink>
        <RouterLink data-route-link="activity" to="/activity">Activity</RouterLink>
        <RouterLink data-route-link="settings" to="/settings">Settings</RouterLink>
      </nav>
    </header>
    <RouterView v-slot="{ Component }">
      <component :is="Component" :state="state" />
    </RouterView>
  </div>
</template>
