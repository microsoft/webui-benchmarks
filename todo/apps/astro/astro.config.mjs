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
  vite: {
    environments: {
      prerender: {
        resolve: {
          noExternal: ["@astrojs/preact"],
        },
      },
      ssr: {
        resolve: {
          noExternal: ["@astrojs/preact"],
        },
      },
    },
  },
});
