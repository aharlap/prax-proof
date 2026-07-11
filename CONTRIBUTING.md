# Contributing to Proof

Proof welcomes focused bug fixes, documentation corrections, accessibility
improvements, and well-scoped features that preserve its small xAPI subset and
self-hosted model.

## Before opening a pull request

1. Open an issue for behavior changes or new features so the contract can be agreed first.
2. Keep changes scoped; do not combine unrelated refactors.
3. Add or update tests for behavior changes.
4. Add `// SPDX-License-Identifier: MIT` to new source, test, migration, and configuration files.
5. Run `pnpm verify` with Node 22 and the package-manager version in `package.json`.

Security reports must follow [SECURITY.md](SECURITY.md), not a public issue.

By contributing, you agree that your contribution is licensed under this
repository's MIT License.
