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

# Find the pi-embedded chunk that defines __exportAll (hooks chunk graph only)
# The hooks reference pi-embedded via ../../pi-embedded-*.js from bundled/*/handler.js
PI_EMBEDDED=$(grep -l 'var __exportAll' "$DIST_DIR"/pi-embedded-*.js 2>/dev/null | head -1)

if [ -z "$PI_EMBEDDED" ]; then
  echo "SKIP: No pi-embedded chunk with __exportAll found (may already be fixed upstream)"
  exit 0
fi

PI_BASENAME=$(basename "$PI_EMBEDDED")

# Check if there are files importing __exportAll from this chunk
AFFECTED_FILES=$(grep -rl "import.*__exportAll.*from.*\"./${PI_BASENAME}\"" "$DIST_DIR"/*.js 2>/dev/null || true)

if [ -z "$AFFECTED_FILES" ]; then
  echo "SKIP: No files import __exportAll from $PI_BASENAME"
  exit 0
fi

# Extract the __exportAll + __defProp helper from the pi-embedded chunk
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

# Redirect imports in affected files
COUNT=0
for f in $AFFECTED_FILES; do
  BASENAME=$(basename "$f")
  # Replace: import { O as __exportAll } from "./pi-embedded-XXXX.js";
  # With:    import { __exportAll } from "./__exportAll.js";
  if sed -i "s|import { O as __exportAll } from \"./${PI_BASENAME}\";|import { __exportAll } from \"./__exportAll.js\";|" "$f"; then
    COUNT=$((COUNT + 1))
    echo "  Fixed: $BASENAME"
  fi
done

echo "Done: patched $COUNT files, created __exportAll.js"
