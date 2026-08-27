// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  addDays,
  format,
  formatDistanceStrict,
  startOfWeek,
} from "date-fns";
import rrulePackage from "rrule/dist/es5/rrule.js";

const { RRule } = rrulePackage;

export function createWorkspaceSchedulePreview(schedule) {
  const options = {
    daily: {
      byweekday: undefined,
      freq: RRule.DAILY,
      interval: 1,
      label: "Every day",
    },
    weekdays: {
      byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR],
      freq: RRule.WEEKLY,
      interval: 1,
      label: "Weekdays",
    },
    weekly: {
      byweekday: [RRule.MO],
      freq: RRule.WEEKLY,
      interval: 1,
      label: "Every Monday",
    },
  }[schedule];
  const weekStart = startOfWeek(new Date(Date.UTC(2026, 7, 31)), {
    weekStartsOn: 1,
  });
  const rule = new RRule({
    byweekday: options.byweekday,
    count: 6,
    dtstart: addDays(weekStart, 1),
    freq: options.freq,
    interval: options.interval,
  });
  return {
    dates: rule.all().slice(0, 4).map((date, index) => ({
      id: `schedule-${index + 1}`,
      label: format(date, "EEE, MMM d 'at' HH:mm"),
    })),
    humanized: formatDistanceStrict(rule.all()[0], addDays(weekStart, -1), {
      addSuffix: true,
    }),
    id: schedule,
    label: options.label,
  };
}
