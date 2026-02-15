#!/usr/bin/env bash
# fix-hook-circular-deps.sh
#
# Fixes the __exportAll circular dependency in the hooks chunk graph
# produced by tsdown. The hooks entry group creates separate chunks
# where pi-embedded-*.js and its consumers form a circular import,
# causing __exportAll to be undefined at module evaluation time.
#
# This script:
# 1. Creates a standalone __exportAll.js module
# 2. Redirects all affected files to import from it
#
# Run after: pnpm build
# See: https://github.com/openclaw/openclaw/issues/13662

set -euo pipefail

DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: dist/ directory not found at $DIST_DIR" >&2
  exit 1
fi

# Find ALL pi-embedded chunks that define __exportAll
PI_CHUNKS=$(grep -l 'var __exportAll' "$DIST_DIR"/pi-embedded-*.js 2>/dev/null || true)

if [ -z "$PI_CHUNKS" ]; then
  echo "SKIP: No pi-embedded chunk with __exportAll found (may already be fixed upstream)"
  exit 0
fi

# Extract the __exportAll + __defProp helper as a standalone module
cat > "$DIST_DIR/__exportAll.js" << 'HELPER_EOF'
// Extracted to break circular dependency in hooks chunk graph
// See: https://github.com/openclaw/openclaw/issues/13662
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) {
		__defProp(target, name, {
			get: all[name],
			enumerable: true
		});
	}
	if (!no_symbols) {
		__defProp(target, Symbol.toStringTag, { value: "Module" });
	}
	return target;
};
export { __exportAll };
HELPER_EOF

# Redirect imports in affected files for ALL pi-embedded chunks
COUNT=0
for PI_EMBEDDED in $PI_CHUNKS; do
  PI_BASENAME=$(basename "$PI_EMBEDDED")
  AFFECTED_FILES=$(grep -rl "import.*__exportAll.*from.*\"./${PI_BASENAME}\"" "$DIST_DIR"/*.js 2>/dev/null || true)
  for f in $AFFECTED_FILES; do
    BASENAME=$(basename "$f")
    # Replace: import { XX as __exportAll } from "./pi-embedded-XXXX.js";
    # With:    import { __exportAll } from "./__exportAll.js";
    # The alias (XX) changes each build, so use a regex to match any alias.
    if sed -i -E "s|import \{ [A-Za-z0-9_]+ as __exportAll \} from \"\.\/${PI_BASENAME//./\\.}\";|import { __exportAll } from \"./__exportAll.js\";|" "$f"; then
      COUNT=$((COUNT + 1))
      echo "  Fixed: $BASENAME"
    fi
  done
done

echo "Done: patched $COUNT files, created __exportAll.js"
