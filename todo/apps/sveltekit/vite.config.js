// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { sveltekit } from "@sveltejs/kit/vite";
import adapter from "@sveltejs/adapter-node";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({
        out: "build",
        precompress: false,
      }),
    }),
  ],
});
