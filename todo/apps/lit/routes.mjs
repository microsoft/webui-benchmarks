// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The single source of truth for the workspace routes.
 *
 * `@lit-labs/router` drives navigation in the browser, where its `Routes`
 * controller owns click interception, history, and the lazy `enter` imports.
 * That controller resolves routes asynchronously, which a synchronous SSR
 * render cannot await, so the server matches the very same table here through
 * `matchRoute()` and renders the identical page component. Both sides read one
 * table, so a route can never exist on only one of them.
 */
export const WORKSPACE_ROUTES = Object.freeze([
  Object.freeze({ id: "work", paths: Object.freeze(["/", "/dynamic", "/cached"]) }),
  Object.freeze({ id: "activity", paths: Object.freeze(["/activity"]) }),
  Object.freeze({ id: "settings", paths: Object.freeze(["/settings"]) }),
]);

const ROUTE_BY_PATH = new Map(
  WORKSPACE_ROUTES.flatMap((route) => route.paths.map((path) => [path, route.id])),
);

/**
 * Resolves `pathname` to a workspace route id, falling back to the work queue
 * so an unknown deep link still renders the benchmark's primary page rather
 * than throwing inside a render pass.
 */
export function matchRoute(pathname) {
  const normalized = pathname.split("?")[0].split("#")[0];
  const trimmed = normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
  return ROUTE_BY_PATH.get(trimmed) ?? "work";
}
