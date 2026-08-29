// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import assert from "node:assert/strict";
import test from "node:test";
import { collectHtmlObservation } from "../../shared/observation.mjs";
import {
  TODO_STATE_VARIANTS,
  createRequestTodoState,
} from "../../shared/state.mjs";
import { collectByteStream } from "../../shared/streaming.mjs";
import { assertValidObservation } from "../../shared/validator.mjs";
import { createAdapterRouteController } from "../lib/adapter-engine.mjs";
import { htmlHeaders } from "../lib/contract.mjs";

for (const appId of ["react", "preact", "solid", "vue", "react-tanstack"]) {
  test(`${appId} uses its native streaming renderer`, async () => {
    const controller = await createAdapterRouteController({ appId });
    assert.equal(controller.metadata.streaming, "native");
    const result = await controller.renderDynamic("/dynamic");
    assert.ok(result.body instanceof ReadableStream);
    assert.equal(Object.hasOwn(htmlHeaders(result), "content-length"), false);
    const body = Buffer.from(await collectByteStream(result.body));
    assertValidObservation(
      collectHtmlObservation(body.toString("utf8")),
      createRequestTodoState(TODO_STATE_VARIANTS[0], result.requestTimestamp),
    );
    assert.ok(Buffer.isBuffer(controller.cached().body));
  });

  test(`${appId} publishes the same semantic DOM and state in complete and progressive suites`, async () => {
    const progressive = await createAdapterRouteController({
      appId,
      responseMode: "progressive",
    });
    const complete = await createAdapterRouteController({
      appId,
      responseMode: "complete",
    });
    assert.equal(progressive.metadata.streaming, "native");
    assert.equal(progressive.metadata.responseMode, "progressive");
    assert.equal(complete.metadata.streaming, "buffered");
    assert.equal(complete.metadata.responseMode, "complete");

    const progressiveResult = await progressive.renderDynamic("/dynamic");
    const completeResult = await complete.renderDynamic("/dynamic");
    // The progressive suite still returns a native ReadableStream; the
    // complete suite always returns a fully collected Buffer -- but both
    // must describe the exact same semantic todo state once decoded.
    assert.ok(progressiveResult.body instanceof ReadableStream);
    assert.ok(Buffer.isBuffer(completeResult.body));
    const progressiveBody = Buffer.from(
      await collectByteStream(progressiveResult.body),
    );
    for (const [body, requestTimestamp] of [
      [progressiveBody, progressiveResult.requestTimestamp],
      [completeResult.body, completeResult.requestTimestamp],
    ]) {
      assertValidObservation(
        collectHtmlObservation(body.toString("utf8")),
        createRequestTodoState(TODO_STATE_VARIANTS[0], requestTimestamp),
      );
    }
  });
}
