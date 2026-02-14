#!/usr/bin/env bash
#
# sync-upstream.sh — Sync sypherin/openclaw fork with upstream openclaw/openclaw
#
# Usage:
#   ./scripts/sync-upstream.sh              # Interactive mode (default)
#   ./scripts/sync-upstream.sh --analyze    # Only analyze, don't merge
#   ./scripts/sync-upstream.sh --auto       # Auto-merge, pause only on conflicts
#   ./scripts/sync-upstream.sh --help       # Show help
#
# What it does:
#   1. Fetches upstream/main
#   2. Analyzes new commits (categorized summary)
#   3. Shows files that conflict with our customizations
#   4. Merges upstream/main (pauses on conflicts for manual resolution)
#   5. Builds (pnpm run build)
#   6. Runs tests (pnpm run test)
#   7. Pushes to origin/main
#   8. Rebuilds the global link (npm link)
#   9. Restarts openclaw services
#

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
ORIGIN_REMOTE="origin"
ORIGIN_BRANCH="main"

# Our fork's custom files that need special attention during merges
FORK_CUSTOM_FILES=(
  "src/security/prompt-injection-guard.ts"
  "src/security/prompt-injection-guard.test.ts"
  "src/browser/eval-security.test.ts"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Mode
MODE="interactive"  # interactive | analyze | auto

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Sync sypherin/openclaw fork with upstream openclaw/openclaw.

Options:
  --analyze    Only analyze upstream changes, don't merge
  --auto       Auto-merge, only pause on conflicts
  --help       Show this help message

Steps performed:
  1. Fetch upstream/main
  2. Analyze & categorize new commits
  3. Identify potential conflicts with fork customizations
  4. Merge upstream/main into current branch
  5. Build (pnpm run build)
  6. Run tests (pnpm run test)
  7. Push to origin/main
  8. Rebuild global link (npm link)
  9. Restart openclaw systemd services
EOF
}

log_step() {
  echo -e "\n${BOLD}${BLUE}==> $1${NC}"
}

log_info() {
  echo -e "${CYAN}    $1${NC}"
}

log_success() {
  echo -e "${GREEN}    ✓ $1${NC}"
}

log_warn() {
  echo -e "${YELLOW}    ⚠ $1${NC}"
}

log_error() {
  echo -e "${RED}    ✗ $1${NC}"
}

confirm() {
  if [[ "$MODE" == "auto" ]]; then
    return 0
  fi
  local prompt="${1:-Continue?}"
  echo -en "${YELLOW}    ${prompt} [y/N] ${NC}"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --analyze) MODE="analyze"; shift ;;
    --auto) MODE="auto"; shift ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

cd "$REPO_DIR"

# ─────────────────────────────────────────────────
# Step 1: Preflight checks
# ─────────────────────────────────────────────────
log_step "Step 1: Preflight checks"

# Check we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  log_error "Not a git repository: $REPO_DIR"
  exit 1
fi

# Check upstream remote exists
if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
  log_error "Remote '$UPSTREAM_REMOTE' not found. Add it with:"
  echo "  git remote add upstream https://github.com/openclaw/openclaw.git"
  exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  log_warn "You have uncommitted changes:"
  git status --short
  if ! confirm "Continue anyway? (changes may be lost during merge)"; then
    exit 1
  fi
fi

# Check current branch
CURRENT_BRANCH=$(git branch --show-current)
log_info "Current branch: $CURRENT_BRANCH"
log_info "Repository: $REPO_DIR"

# ─────────────────────────────────────────────────
# Step 2: Fetch upstream
# ─────────────────────────────────────────────────
log_step "Step 2: Fetching upstream"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --tags
log_success "Fetched $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"

# ─────────────────────────────────────────────────
# Step 3: Analyze upstream changes
# ─────────────────────────────────────────────────
log_step "Step 3: Analyzing upstream changes"

NEW_COMMITS=$(git rev-list --count HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
if [[ "$NEW_COMMITS" -eq 0 ]]; then
  log_success "Already up to date with upstream. Nothing to do."
  exit 0
fi

log_info "$NEW_COMMITS new commits from upstream"

# Current and upstream versions
CURRENT_VERSION=$(git log -1 --format="%H" HEAD | head -c 10)
UPSTREAM_VERSION=$(git log -1 --format="%H" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | head -c 10)
log_info "Current HEAD: $CURRENT_VERSION"
log_info "Upstream HEAD: $UPSTREAM_VERSION"

# Version bump detection
VERSION_COMMITS=$(git log --oneline HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | grep -i 'release\|version\|bump' || true)
if [[ -n "$VERSION_COMMITS" ]]; then
  echo -e "\n${BOLD}  Version changes:${NC}"
  echo "$VERSION_COMMITS" | while read -r line; do
    echo "    $line"
  done
fi

# Categorize by type
echo -e "\n${BOLD}  Commit breakdown by type:${NC}"
for type in feat fix refactor perf test docs chore ci build style; do
  count=$(git log --oneline HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | grep -ci "^[a-f0-9]* $type" || true)
  if [[ "$count" -gt 0 ]]; then
    printf "    %-12s %s\n" "$type:" "$count"
  fi
done

# Show by scope
echo -e "\n${BOLD}  Top scopes:${NC}"
git log --oneline HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" \
  | grep -oP '\(\K[^)]+' 2>/dev/null \
  | sort | uniq -c | sort -rn | head -15 \
  | while read -r count scope; do
    printf "    %-20s %s\n" "$scope:" "$count"
  done

# Features
echo -e "\n${BOLD}  New features:${NC}"
git log --oneline HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" \
  | grep -i '^[a-f0-9]* feat' \
  | while read -r line; do
    echo "    $line"
  done

# Security
SECURITY_COUNT=$(git log --oneline HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" \
  | grep -ci 'secur\|vuln\|auth\|xss\|inject\|ssrf\|csrf\|sanitiz\|bypass\|brute' || true)
if [[ "$SECURITY_COUNT" -gt 0 ]]; then
  echo -e "\n${BOLD}  Security-related commits: ${SECURITY_COUNT}${NC}"
  git log --oneline HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" \
    | grep -i 'secur\|vuln\|auth\|xss\|inject\|ssrf\|csrf\|sanitiz\|bypass\|brute' \
    | head -20 \
    | while read -r line; do
      echo "    $line"
    done
  if [[ "$SECURITY_COUNT" -gt 20 ]]; then
    echo "    ... and $((SECURITY_COUNT - 20)) more"
  fi
fi

# ─────────────────────────────────────────────────
# Step 4: Check for conflicts with our customizations
# ─────────────────────────────────────────────────
log_step "Step 4: Checking for conflicts with fork customizations"

CONFLICTING_FILES=$(git diff --name-only HEAD.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" | grep -E '(gateway/auth|security/prompt-injection|browser/eval-security|security/index|infra/state-migrations|config/sessions/store)' || true)

if [[ -n "$CONFLICTING_FILES" ]]; then
  log_warn "Upstream modified these files that we've customized:"
  echo "$CONFLICTING_FILES" | while read -r f; do
    echo "    - $f"
  done
else
  log_success "No conflicts with our customized files"
fi

# Check if our fork-only files would be deleted
echo ""
for f in "${FORK_CUSTOM_FILES[@]}"; do
  if git show "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH:$f" &>/dev/null 2>&1; then
    log_info "Fork file exists in upstream: $f"
  else
    log_warn "Fork-only file (not in upstream): $f — will be preserved"
  fi
done

# If analyze-only mode, stop here
if [[ "$MODE" == "analyze" ]]; then
  echo ""
  log_success "Analysis complete. Run without --analyze to proceed with merge."
  exit 0
fi

# Confirm before merging
echo ""
if ! confirm "Proceed with merging $NEW_COMMITS upstream commits?"; then
  log_info "Aborted. Run with --analyze to review changes first."
  exit 0
fi

# ─────────────────────────────────────────────────
# Step 5: Backup fork-only files
# ─────────────────────────────────────────────────
log_step "Step 5: Backing up fork-only files"

BACKUP_DIR="$REPO_DIR/.fork-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

for f in "${FORK_CUSTOM_FILES[@]}"; do
  if [[ -f "$REPO_DIR/$f" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp "$REPO_DIR/$f" "$BACKUP_DIR/$f"
    log_info "Backed up: $f"
  fi
done
log_success "Backup saved to $BACKUP_DIR"

# ─────────────────────────────────────────────────
# Step 6: Merge upstream
# ─────────────────────────────────────────────────
log_step "Step 6: Merging upstream/$UPSTREAM_BRANCH"

if git merge "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" --no-edit 2>/dev/null; then
  log_success "Merge completed cleanly!"
else
  echo ""
  log_warn "Merge conflicts detected!"
  echo ""
  git diff --name-only --diff-filter=U | while read -r f; do
    log_error "CONFLICT: $f"
  done
  echo ""
  echo -e "${YELLOW}    Please resolve conflicts manually, then run:${NC}"
  echo "      git add <resolved-files>"
  echo "      git commit"
  echo ""
  echo -e "${YELLOW}    After resolving, re-run this script to continue with build/test/push.${NC}"
  echo ""
  echo -e "${YELLOW}    To abort the merge:${NC}"
  echo "      git merge --abort"
  exit 1
fi

# ─────────────────────────────────────────────────
# Step 7: Restore fork-only files if deleted by merge
# ─────────────────────────────────────────────────
log_step "Step 7: Restoring fork-only files"

RESTORED=0
for f in "${FORK_CUSTOM_FILES[@]}"; do
  if [[ ! -f "$REPO_DIR/$f" && -f "$BACKUP_DIR/$f" ]]; then
    mkdir -p "$REPO_DIR/$(dirname "$f")"
    cp "$BACKUP_DIR/$f" "$REPO_DIR/$f"
    git add "$REPO_DIR/$f"
    log_info "Restored: $f"
    RESTORED=1
  fi
done

if [[ "$RESTORED" -eq 1 ]]; then
  git commit -m "$(cat <<'EOF'
chore: restore fork-only files after upstream merge

Re-add fork-specific security tests and prompt injection guard
that don't exist in upstream.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
  log_success "Fork-only files restored and committed"
else
  log_info "All fork-only files survived the merge"
fi

# ─────────────────────────────────────────────────
# Step 8: Build
# ─────────────────────────────────────────────────
log_step "Step 8: Building"

if pnpm run build; then
  log_success "Build succeeded"
else
  log_error "Build failed! Fix errors before continuing."
  echo -e "${YELLOW}    After fixing, run: pnpm run build && pnpm run test${NC}"
  exit 1
fi

# ─────────────────────────────────────────────────
# Step 9: Run tests
# ─────────────────────────────────────────────────
log_step "Step 9: Running tests"

if pnpm run test 2>&1 | tail -20; then
  log_success "Tests passed"
else
  log_warn "Some tests may have failed. Check output above."
  if ! confirm "Continue anyway?"; then
    exit 1
  fi
fi

# ─────────────────────────────────────────────────
# Step 10: Push to origin
# ─────────────────────────────────────────────────
log_step "Step 10: Pushing to origin"

if [[ "$MODE" != "auto" ]]; then
  if ! confirm "Push to $ORIGIN_REMOTE/$ORIGIN_BRANCH?"; then
    log_info "Skipped push. You can push manually with: git push"
    exit 0
  fi
fi

git push "$ORIGIN_REMOTE" "$CURRENT_BRANCH"
log_success "Pushed to $ORIGIN_REMOTE/$CURRENT_BRANCH"

# ─────────────────────────────────────────────────
# Step 11: Rebuild global link
# ─────────────────────────────────────────────────
log_step "Step 11: Rebuilding global link"

if npm link 2>/dev/null; then
  log_success "Global link updated"
else
  log_warn "npm link failed (non-critical). You can run it manually."
fi

# ─────────────────────────────────────────────────
# Step 12: Restart openclaw services
# ─────────────────────────────────────────────────
log_step "Step 12: Restarting openclaw services"

if ! confirm "Restart openclaw-gateway and openclaw-watchdog services?"; then
  log_info "Skipped restart. Restart manually with:"
  echo "    systemctl --user restart openclaw-gateway openclaw-watchdog"
  exit 0
fi

if systemctl --user restart openclaw-gateway 2>/dev/null; then
  log_success "openclaw-gateway restarted"
else
  log_warn "Failed to restart openclaw-gateway (service may not exist)"
fi

if systemctl --user restart openclaw-watchdog 2>/dev/null; then
  log_success "openclaw-watchdog restarted"
else
  log_warn "Failed to restart openclaw-watchdog (service may not exist)"
fi

# Wait a moment and check status
sleep 2
echo ""
log_info "Service status:"
systemctl --user is-active openclaw-gateway 2>/dev/null && log_success "openclaw-gateway: active" || log_warn "openclaw-gateway: inactive"
systemctl --user is-active openclaw-watchdog 2>/dev/null && log_success "openclaw-watchdog: active" || log_warn "openclaw-watchdog: inactive"

# ─────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Upstream sync complete!${NC}"
echo -e "${BOLD}${GREEN}  $NEW_COMMITS commits merged from upstream${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════${NC}"
echo ""
