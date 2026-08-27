<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

<script setup>
import { onMounted, ref, shallowRef } from "vue";
import {
  saveSettings,
  selectDensity,
  toggleSetting,
} from "../../../shared/workspace-interactions.mjs";

const props = defineProps({
  state: { type: Object, required: true },
});
const current = shallowRef(props.state);
const routeReady = ref(false);
onMounted(() => {
  routeReady.value = true;
});

function chooseDensity(density) {
  current.value = selectDensity(current.value, density);
}

function changeSetting(settingId) {
  current.value = toggleSetting(current.value, settingId);
}

function save() {
  current.value = saveSettings(current.value);
}
</script>

<template>
  <main
    class="workspace-page settings-page"
    :data-density="current.settings.density"
    data-route-page="settings"
    :data-route-ready="routeReady || undefined"
  >
    <header class="workspace-page__header">
      <div>
        <h1>{{ current.settings.title }}</h1>
        <p>{{ current.settings.description }}</p>
      </div>
      <span class="settings-status" role="status">
        {{ current.settings.statusLabel }}
      </span>
    </header>
    <section class="settings-section">
      <h2>Interface density</h2>
      <div class="settings-density" role="group" aria-label="Interface density">
        <button
          v-for="option in current.settings.densityOptions"
          :key="option.id"
          :aria-pressed="option.selected"
          data-action="setting-density"
          :data-density="option.id"
          type="button"
          @click="chooseDensity(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </section>
    <section class="settings-section">
      <h2>Workspace behavior</h2>
      <div class="settings-grid">
        <label
          v-for="setting in current.settings.toggles"
          :key="setting.id"
          class="setting-control"
        >
          <span>
            <strong>{{ setting.label }}</strong>
            <small>{{ setting.description }}</small>
          </span>
          <input
            :checked="setting.enabled"
            data-action="setting-toggle"
            :data-setting-id="setting.id"
            type="checkbox"
            @change="changeSetting(setting.id)"
          />
        </label>
      </div>
    </section>
    <footer class="settings-actions">
      <button
        class="workspace-action"
        data-action="settings-save"
        :disabled="!current.settings.dirty"
        type="button"
        @click="save"
      >
        Save preferences
      </button>
    </footer>
  </main>
</template>
