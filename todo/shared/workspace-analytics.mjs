// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  arc,
  area,
  bin,
  curveMonotoneX,
  extent,
  line,
  max,
  mean,
  pie,
  rollups,
  scaleBand,
  scaleLinear,
  stack,
  sum,
} from "d3";

export function createWorkspaceAnalytics(rows) {
  const priorities = ["high", "medium", "low"];
  const counts = new Map(
    rollups(rows, (items) => items.length, (row) => row.priority),
  );
  const maximum = max(priorities, (priority) => counts.get(priority) ?? 0) || 1;
  const width = scaleLinear().domain([0, maximum]).range([0, 100]);
  const x = scaleBand().domain(priorities).range([24, 276]).padding(0.22);
  const priorityBars = priorities.map((priority) => ({
    count: counts.get(priority) ?? 0,
    id: priority,
    label: `${priority[0].toUpperCase()}${priority.slice(1)}`,
    percent: width(counts.get(priority) ?? 0),
    x: x(priority) ?? 0,
  }));

  const buckets = Array.from({ length: 12 }, (_, index) => {
    const slice = rows.filter((_, rowIndex) => rowIndex % 12 === index);
    return {
      completed: slice.filter(({ completed }) => completed).length,
      index,
      pending: slice.filter(({ completed }) => !completed).length,
      total: slice.length,
    };
  });
  const chartX = scaleLinear().domain([0, 11]).range([8, 292]);
  const chartY = scaleLinear()
    .domain([0, max(buckets, ({ total }) => total) || 1])
    .range([112, 8]);
  const trendPath = line()
    .x(({ index }) => chartX(index))
    .y(({ total }) => chartY(total))
    .curve(curveMonotoneX)(buckets) ?? "";
  const areaPath = area()
    .x(({ index }) => chartX(index))
    .y0(112)
    .y1(({ completed }) => chartY(completed))
    .curve(curveMonotoneX)(buckets) ?? "";

  const pieGenerator = pie().value((entry) => entry.value);
  const arcGenerator = arc().innerRadius(30).outerRadius(52);
  const statusValues = [
    { id: "pending", value: rows.filter(({ completed }) => !completed).length },
    { id: "completed", value: rows.filter(({ completed }) => completed).length },
  ];
  const donutSegments = pieGenerator(statusValues).map((segment) => ({
    id: segment.data.id,
    path: arcGenerator(segment) ?? "",
    value: segment.data.value,
  }));

  const tagCounts = rows.map((row) =>
    row.tagLabel === "No tags" ? 0 : row.tagLabel.split(",").length
  );
  const tagExtent = extent(tagCounts);
  const tagBins = bin()
    .domain([
      Number.isFinite(tagExtent[0]) ? tagExtent[0] : 0,
      Number.isFinite(tagExtent[1]) ? tagExtent[1] + 1 : 1,
    ])
    .thresholds(4)(tagCounts)
    .map((bucket, index) => ({ count: bucket.length, index }));
  const layers = stack()
    .keys(["pending", "completed"])(
      buckets.map(({ completed, pending }) => ({ completed, pending })),
    )
    .map((layer, index) => ({
      id: index === 0 ? "pending" : "completed",
      total: sum(layer, ([start, end]) => end - start),
    }));

  return {
    areaPath,
    averageTags: mean(tagCounts) ?? 0,
    averageTagsDisplay: (mean(tagCounts) ?? 0).toFixed(1),
    donutSegments,
    layers,
    priorityBars,
    tagBins,
    trendPath,
  };
}
