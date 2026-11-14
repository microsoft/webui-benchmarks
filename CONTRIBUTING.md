<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT license. -->

# Contributing

## Start with an issue

Issues are the most valuable way to contribute to this project. Bug reports,
benchmark methodology feedback, and suggestions help maintainers understand and
prioritize problems.

Please open or join an issue instead of submitting a pull request. Maintainers
will ask for help with a pull request in the issue if a contribution is needed;
please wait for that invitation before opening one.

## Reporting issues

Search the [existing issues](https://github.com/microsoft/webui-benchmarks/issues)
before opening a new one. For a bug, include the command and case, exact
reproduction steps, expected and actual behavior, relevant logs, operating
system, and runtime versions. For benchmark methodology or documentation
feedback, describe the affected comparison or page and the change you propose.
Do not include sensitive data in reports. For vulnerabilities, follow
[SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Developing locally

If a maintainer invites you to contribute a change, follow the
[setup instructions](./README.md#reproducible-setup) from the repository root.
The full build and test suite are:

```bash
pnpm run build
pnpm test
```

For a focused change, run the relevant subset as well. For example:

```bash
pnpm run test:repository
pnpm run test:todo:contract
pnpm run test:todo:runner
pnpm run test:todo:browser
pnpm run test:todo:demo
```

Some tests require production build artifacts and Chromium; the full setup
installs both. CI builds all artifacts and runs the full suite. See the
[repository layout](./README.md#repository-layout) for the code organization.

When changing a benchmark case, keep the shared workload and correctness
contract aligned across implementations, update relevant methodology
documentation, and include appropriate tests. Performance comparisons should
include their configuration and raw evidence, not just a headline number.
See the [measurement contract](./README.md#measurement-contract) and
[results guidance](./results/README.md).

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
