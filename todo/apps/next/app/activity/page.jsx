// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ActivityPage } from "../../../react/components/activity-page.jsx";
import { nextDynamicTodoState } from "../../lib/server-state.mjs";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const runtime = "nodejs";

export default function ActivityRoute() {
  return <ActivityPage state={nextDynamicTodoState()} />;
}
