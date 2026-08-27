<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<template>
  <div class="workspace-shell">
    <header class="workspace-nav">
      <NuxtLink class="workspace-brand" to="/dynamic">
        <span class="workspace-brand__mark" aria-hidden="true">W</span>
        <span>
          <strong>Workstream</strong>
          <small>Migration benchmark</small>
        </span>
      </NuxtLink>
      <nav aria-label="Workspace">
        <NuxtLink data-route-link="work" to="/dynamic">Work queue</NuxtLink>
        <NuxtLink data-route-link="activity" to="/activity">Activity</NuxtLink>
        <NuxtLink data-route-link="settings" to="/settings">Settings</NuxtLink>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>
