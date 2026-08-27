<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script>
  import {
    saveSettings,
    selectDensity,
    toggleSetting,
  } from "../../../../../shared/workspace-interactions.mjs";
  import { onMount } from "svelte";

  export let state;
  let current = state;
  let routeReady = false;
  onMount(() => {
    routeReady = true;
  });

  function chooseDensity(density) {
    current = selectDensity(current, density);
  }

  function changeSetting(settingId) {
    current = toggleSetting(current, settingId);
  }

  function save() {
    current = saveSettings(current);
  }
</script>

<main
  class="workspace-page settings-page"
  data-density={current.settings.density}
  data-route-page="settings"
  data-route-ready={routeReady || undefined}
>
  <header class="workspace-page__header">
    <div>
      <h1>{current.settings.title}</h1>
      <p>{current.settings.description}</p>
    </div>
    <span class="settings-status" role="status">
      {current.settings.statusLabel}
    </span>
  </header>
  <section class="settings-section">
    <h2>Interface density</h2>
    <div class="settings-density" role="group" aria-label="Interface density">
      {#each current.settings.densityOptions as option (option.id)}
        <button
          aria-pressed={option.selected}
          data-action="setting-density"
          data-density={option.id}
          on:click={() => chooseDensity(option.id)}
          type="button"
        >
          {option.label}
        </button>
      {/each}
    </div>
  </section>
  <section class="settings-section">
    <h2>Workspace behavior</h2>
    <div class="settings-grid">
      {#each current.settings.toggles as setting (setting.id)}
        <label class="setting-control">
          <span>
            <strong>{setting.label}</strong>
            <small>{setting.description}</small>
          </span>
          <input
            checked={setting.enabled}
            data-action="setting-toggle"
            data-setting-id={setting.id}
            on:change={() => changeSetting(setting.id)}
            type="checkbox"
          />
        </label>
      {/each}
    </div>
  </section>
  <footer class="settings-actions">
    <button
      class="workspace-action"
      data-action="settings-save"
      disabled={!current.settings.dirty}
      on:click={save}
      type="button"
    >
      Save preferences
    </button>
  </footer>
</main>
