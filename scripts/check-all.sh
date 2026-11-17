#!/usr/bin/env sh
# Runs every check and fails if any fails: type check, unit tests, build, the four interface tests.
# Usage: sh scripts/check-all.sh   (Linux: the desktop test runs under xvfb-run when available)
set -e
cd "$(dirname "$0")/.."
node node_modules/typescript/bin/tsc -p tsconfig.json
npm test 2>&1 | tee .tmp-unit.log | grep -E "^# (pass|fail)"
grep -q "^# fail 0" .tmp-unit.log
node scripts/build.mjs
for t in vertical-slice workflows render-compare; do
  node --disable-warning=ExperimentalWarning e2e/$t.e2e.ts > .tmp-$t.log 2>&1 || { tail -30 .tmp-$t.log; exit 1; }
  tail -1 .tmp-$t.log
done
if command -v xvfb-run >/dev/null 2>&1; then xvfb-run -a node --disable-warning=ExperimentalWarning e2e/desktop.e2e.ts > .tmp-desktop.log 2>&1 || { tail -30 .tmp-desktop.log; exit 1; }
else node --disable-warning=ExperimentalWarning e2e/desktop.e2e.ts > .tmp-desktop.log 2>&1 || { tail -30 .tmp-desktop.log; exit 1; }; fi
grep "steps passed" .tmp-desktop.log
rm -f .tmp-unit.log .tmp-vertical-slice.log .tmp-workflows.log .tmp-render-compare.log .tmp-desktop.log
echo "ALL CHECKS PASSED"
