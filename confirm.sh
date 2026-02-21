#!/usr/bin/env bash
set -euo pipefail

echo "---------------------------------"
echo "           Code Prettify         "
echo "---------------------------------"
npx prettier . --write
echo "---------------------------------"
echo "             Code Lint           "
echo "---------------------------------"
npx eslint .
echo "---------------------------------"
echo "              Build              "
echo "---------------------------------"
rm -rf dist
npx tsc
echo "---------------------------------"
echo "               Done              "
echo "---------------------------------"
