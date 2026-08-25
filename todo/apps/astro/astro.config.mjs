// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import node from "@astrojs/node";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

export default defineConfig({
  adapter: node({
    mode: "standalone",
  }),
  integrations: [preact()],
  output: "server",
});
