// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createTodoState } from "../../../shared/state.mjs";
import { createRenderer } from "../adapter.mjs";

test("React native stream propagates cancellation", async () => {
  const renderer = await createRenderer();
  const stream = await renderer.renderStream(createTodoState(0), "/dynamic");
  assert.ok(stream instanceof ReadableStream);
  await stream.cancel(new Error("test cancellation"));
  await new Promise((resolve) => setImmediate(resolve));
});
