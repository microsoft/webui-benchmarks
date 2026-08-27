// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

function visibleActivityEvents(activity, activeFilter) {
  return activity.events.map((event) => ({
    ...event,
    visible: activeFilter === "all" || event.type === activeFilter,
  }));
}

export function filterActivity(state, filterId) {
  if (!state.activity.filters.some((filter) => filter.id === filterId)) {
    throw new RangeError(`Unknown activity filter '${filterId}'`);
  }
  return {
    ...state,
    activity: {
      ...state.activity,
      activeFilter: filterId,
      events: visibleActivityEvents(state.activity, filterId),
      filters: state.activity.filters.map((filter) => ({
        ...filter,
        active: filter.id === filterId,
      })),
    },
  };
}

export function toggleActivityDetail(state, eventId) {
  if (!state.activity.events.some((event) => event.id === eventId)) {
    throw new RangeError(`Unknown activity event '${eventId}'`);
  }
  return {
    ...state,
    activity: {
      ...state.activity,
      events: state.activity.events.map((event) =>
        event.id === eventId
          ? { ...event, expanded: !event.expanded }
          : event
      ),
    },
  };
}

export function markActivityRead(state) {
  return {
    ...state,
    activity: {
      ...state.activity,
      events: state.activity.events.map((event) => ({
        ...event,
        unread: false,
      })),
      unreadCount: 0,
      unreadLabel: "0 unread events",
    },
  };
}

export function toggleSetting(state, settingId) {
  if (!state.settings.toggles.some((setting) => setting.id === settingId)) {
    throw new RangeError(`Unknown setting '${settingId}'`);
  }
  return {
    ...state,
    settings: {
      ...state.settings,
      dirty: true,
      saved: false,
      statusLabel: "Unsaved changes",
      toggles: state.settings.toggles.map((setting) =>
        setting.id === settingId
          ? { ...setting, enabled: !setting.enabled }
          : setting
      ),
    },
  };
}

export function selectDensity(state, density) {
  if (!state.settings.densityOptions.some((option) => option.id === density)) {
    throw new RangeError(`Unknown density '${density}'`);
  }
  return {
    ...state,
    settings: {
      ...state.settings,
      density,
      densityOptions: state.settings.densityOptions.map((option) => ({
        ...option,
        selected: option.id === density,
      })),
      dirty: true,
      saved: false,
      statusLabel: "Unsaved changes",
    },
  };
}

export function saveSettings(state) {
  return {
    ...state,
    settings: {
      ...state.settings,
      dirty: false,
      saved: true,
      statusLabel: "Preferences saved",
    },
  };
}
