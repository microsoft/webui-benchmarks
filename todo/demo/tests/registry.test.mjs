// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { createCaseMatrix } from "../../runner/lib/cases.mjs";
import {
  DEMO_APPLICATION_COUNT,
  DEMO_PRODUCT_COUNT,
  DEMO_RESPONSE_MODES,
  assertDemoRegistry,
  createDemoRegistry,
  groupDemoProducts,
} from "../registry.mjs";

test("the demo hosts every todo application in both response modes", () => {
  const products = createDemoRegistry();
  assert.equal(products.length, DEMO_PRODUCT_COUNT);
  assert.equal(new Set(products.map(({ id }) => id)).size, DEMO_PRODUCT_COUNT);
  assert.equal(
    new Set(products.map(({ application }) => application)).size,
    DEMO_APPLICATION_COUNT,
  );
  for (const responseMode of DEMO_RESPONSE_MODES) {
    assert.equal(
      products.filter((product) => product.responseMode === responseMode).length,
      DEMO_APPLICATION_COUNT,
    );
  }
});

test("every demo product comes from an official benchmark case", () => {
  const official = new Map(
    DEMO_RESPONSE_MODES.map((responseMode) => [
      responseMode,
      new Map(
        createCaseMatrix({ responseMode }).map((benchmarkCase) => [
          benchmarkCase.id,
          benchmarkCase,
        ]),
      ),
    ]),
  );
  for (const product of createDemoRegistry()) {
    const source = official.get(product.responseMode).get(product.caseId);
    assert.ok(source !== undefined, `${product.caseId} is not an official case`);
    assert.equal(product.appId, source.appId);
    assert.equal(product.renderer, source.renderer);
    assert.equal(product.sourceCase.responseMode, product.responseMode);
    assert.equal(product.launchPath, `/app/${product.id}`);
    assert.equal(product.benchmarkPath, `/benchmark/${product.id}`);
  }
});

test("the registry keeps both variants of one application adjacent", () => {
  const groups = groupDemoProducts(createDemoRegistry());
  assert.equal(groups.length, DEMO_APPLICATION_COUNT);
  for (const group of groups) {
    assert.deepEqual(
      group.variants.map(({ responseMode }) => responseMode),
      [...DEMO_RESPONSE_MODES],
    );
  }
});

test("the registry rejects unsafe or incomplete product sets", () => {
  const products = createDemoRegistry();
  assert.throws(() => assertDemoRegistry(products.slice(1)), /exactly 26 products/u);
  const unsafe = products.map((product, index) =>
    index === 0 ? { ...product, launchPath: "/app/../etc" } : product
  );
  assert.throws(() => assertDemoRegistry(unsafe), /unsafe base path/u);
  const unsafeBenchmark = products.map((product, index) =>
    index === 0 ? { ...product, benchmarkPath: "/benchmark/../etc" } : product
  );
  assert.throws(
    () => assertDemoRegistry(unsafeBenchmark),
    /unsafe benchmark path/u,
  );
});
