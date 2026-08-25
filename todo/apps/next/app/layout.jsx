// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import "../../../shared/styles.css";

export const metadata = {
  title: "SSR Todo Benchmark",
  description: "Equivalent full-stack todo SSR benchmark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
