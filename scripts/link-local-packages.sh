#!/usr/bin/env sh
# Development-environment helper.
# The build sandbox has no network access, so `npm install` is not possible there.
# The exact package versions listed in package.json are already installed in
# /opt/npm-tools/node_modules; this script links them into ./node_modules.
# On any machine with internet access, run `npm install` instead of this script.
set -e
SRC=/opt/npm-tools/node_modules
cd "$(dirname "$0")/.."
mkdir -p node_modules/@types node_modules/@esbuild
for p in d3-geo d3-array internmap robust-predicates react react-dom scheduler esbuild playwright playwright-core; do
  [ -e "node_modules/$p" ] || ln -s "$SRC/$p" "node_modules/$p"
done
for p in node d3-geo geojson; do
  [ -e "node_modules/@types/$p" ] || ln -s "$SRC/@types/$p" "node_modules/@types/$p"
done
[ -e node_modules/@esbuild/linux-x64 ] || ln -s "$SRC/@esbuild/linux-x64" node_modules/@esbuild/linux-x64
[ -e node_modules/undici-types ] || ln -s "$SRC/undici-types" node_modules/undici-types
[ -e node_modules/typescript ] || ln -s "$(npm root -g)/typescript" node_modules/typescript
echo "Linked local packages into node_modules."
