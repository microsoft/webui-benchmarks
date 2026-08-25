// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import adapter from "@sveltejs/adapter-node";

const config = {
  kit: {
    adapter: adapter({
      out: "build",
      precompress: false,
    }),
  },
};

export default config;
