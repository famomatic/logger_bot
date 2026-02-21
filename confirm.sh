#!/usr/bin/env bash
set -euo pipefail

npx prettier . --write
npx eslint .
rm -rf dist
npx tsc
