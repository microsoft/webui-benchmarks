// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import Link from "next/link";

export default function BenchmarkIndex() {
  return (
    <main>
      <h1>SSR Todo Benchmark</h1>
      <nav aria-label="Benchmark render modes">
        <Link href="/dynamic">Dynamic SSR</Link>
        <Link href="/cached">Static cached response</Link>
      </nav>
    </main>
  );
}
