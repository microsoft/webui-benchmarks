// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from "node:assert/strict";
import test from "node:test";
import { parseBrowserOptions } from "../cli.mjs";

test("browser options ignore the pnpm argument separator", () => {
  assert.deepEqual(
    parseBrowserOptions(["--", "--quick", "--apps", "react,solid"]),
    {
      appFilters: ["react", "solid"],
      build: false,
      headless: true,
      json: false,
      mode: "quick",
    },
  );
});

test("browser options expose selective ten-round refreshes", () => {
  assert.deepEqual(
    parseBrowserOptions(["--refresh", "--apps", "webui-node-http"]),
    {
      appFilters: ["webui-node-http"],
      build: false,
      headless: true,
      json: false,
      mode: "refresh",
    },
  );
});
