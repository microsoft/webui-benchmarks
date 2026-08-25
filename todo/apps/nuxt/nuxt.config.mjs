// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  css: [
    fileURLToPath(new URL("../../shared/styles.css", import.meta.url)),
  ],
  devtools: { enabled: false },
  nitro: {
    preset: "node-server",
  },
  routeRules: {
    "/dynamic": {
      cache: false,
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate",
      },
      swr: false,
    },
    "/cached": {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
      },
      prerender: true,
    },
  },
  ssr: true,
});
