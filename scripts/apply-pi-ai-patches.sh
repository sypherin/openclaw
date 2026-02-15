#!/bin/bash
# apply-pi-ai-patches.sh — Reapply openclaw compatibility patches to @mariozechner/pi-ai
# Run after `pnpm install` to patch all pi-ai versions in node_modules.
#
# Patches applied:
#   1. Assistant content as string (not array) — prevents models from mimicking JSON structure
#   2. Empty tool call filter — strips toolCall blocks with empty names (NVIDIA GLM-5 bug)
#   3. Reasoning→text fallback — promotes thinking blocks to text when no text/tool blocks exist
#   4. 120s per-request timeout — enables faster failover instead of 10-min default hang

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

# Find all pi-ai openai-completions.js files
FILES=$(find "$ROOT/node_modules/.pnpm" -path '*pi-ai*/dist/providers/openai-completions.js' 2>/dev/null)

if [ -z "$FILES" ]; then
    echo "ERROR: No pi-ai openai-completions.js files found in node_modules"
    exit 1
fi

PATCHED=0
SKIPPED=0

for FILE in $FILES; do
    VERSION=$(echo "$FILE" | grep -oP 'pi-ai@\K[0-9.]+')
    echo "--- Patching pi-ai@${VERSION}: $(basename "$FILE")"

    set +e
    python3 - "$FILE" <<'PYTHON_PATCH'
import sys, re

filepath = sys.argv[1]
with open(filepath, 'r') as f:
    code = f.read()

changed = False

# ============================================================
# PATCH 1: Assistant content as plain string (not array)
# ============================================================
# Original code has an if/else: github-copilot gets .join(""),
# everyone else gets array of {type:"text",text:...} objects.
# We make ALL providers use .join("") because array format causes
# models like DeepSeek to mimic the JSON structure in responses.

old_assistant = '''if (model.provider === "github-copilot") {
                assistantMsg.content = nonEmptyTextBlocks.map((b) => sanitizeSurrogates(b.text)).join("");
            }
            else {
                assistantMsg.content = nonEmptyTextBlocks.map((b) => {
                    return { type: "text", text: sanitizeSurrogates(b.text) };
                });
            }'''

new_assistant = '''// Send assistant content as a plain string for all providers.
                // Array format [{"type":"text","text":"..."}] causes some models
                // (DeepSeek, etc.) to mimic the JSON structure in their responses.
                // String content is always valid for text-only messages in the OpenAI API.
                assistantMsg.content = nonEmptyTextBlocks.map((b) => sanitizeSurrogates(b.text)).join("");'''

if old_assistant in code:
    code = code.replace(old_assistant, new_assistant)
    changed = True
    print("  [1/4] Applied: assistant content as string")
elif 'assistantMsg.content = nonEmptyTextBlocks.map((b) => sanitizeSurrogates(b.text)).join("")' in code:
    print("  [1/4] Already applied: assistant content as string")
else:
    print("  [1/4] WARNING: Could not find assistant content pattern to patch")

# ============================================================
# PATCH 2+3: Empty tool call filter + reasoning→text fallback
# ============================================================
# Inserted right after the final `finishCurrentBlock(currentBlock);`
# in the streaming response handler (the one NOT inside a nested if/for).

FILTER_MARKER = '// Filter out invalid/empty tool calls'
FALLBACK_PATCH = '''            // Filter out invalid/empty tool calls (e.g. NVIDIA GLM-5 sometimes sends
            // tool_calls with empty id/name that cause "Tool not found" errors)
            output.content = output.content.filter(b => {
                if (b.type === "toolCall" && (!b.name || b.name.trim() === "")) return false;
                return true;
            });
            // Fallback: if model returned only reasoning_content (no text, no tool calls),
            // promote thinking to text so the user sees a response (NVIDIA GLM-4.7, Kimi K2.5)
            const hasTextBlock = output.content.some(b => b.type === "text" && b.text && b.text.length > 0);
            const hasToolCall = output.content.some(b => b.type === "toolCall");
            if (!hasTextBlock && !hasToolCall) {
                const thinkingBlock = output.content.find(b => b.type === "thinking" && b.thinking && b.thinking.length > 0);
                if (thinkingBlock) {
                    const textBlock = { type: "text", text: thinkingBlock.thinking };
                    output.content.push(textBlock);
                    stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
                    stream.push({ type: "text_delta", contentIndex: output.content.length - 1, delta: textBlock.text, partial: output });
                }
            }'''

if FILTER_MARKER in code:
    print("  [2/4] Already applied: empty tool call filter")
    print("  [3/4] Already applied: reasoning→text fallback")
else:
    # Find the last finishCurrentBlock that's followed by signal/aborted check
    # This is the one at the end of the main streaming loop
    pattern = r'(            finishCurrentBlock\(currentBlock\);\n)(            if \(options\?\.signal\?\.aborted\))'
    match = re.search(pattern, code)
    if match:
        insertion_point = match.start() + len(match.group(1))
        code = code[:insertion_point] + FALLBACK_PATCH + '\n' + code[insertion_point:]
        changed = True
        print("  [2/4] Applied: empty tool call filter")
        print("  [3/4] Applied: reasoning→text fallback")
    else:
        print("  [2/4] WARNING: Could not find insertion point for filter/fallback")
        print("  [3/4] WARNING: (same)")

# ============================================================
# PATCH 4: 120s per-request timeout on OpenAI client
# ============================================================
# Add timeout: 120000 to the new OpenAI({...}) constructor

TIMEOUT_MARKER = 'timeout: 120000'

if TIMEOUT_MARKER in code:
    print("  [4/4] Already applied: 120s timeout")
else:
    old_client = '''dangerouslyAllowBrowser: true,
        defaultHeaders: headers,
    });'''
    new_client = '''dangerouslyAllowBrowser: true,
        defaultHeaders: headers,
        timeout: 120000,
    });'''
    if old_client in code:
        code = code.replace(old_client, new_client)
        changed = True
        print("  [4/4] Applied: 120s timeout")
    else:
        print("  [4/4] WARNING: Could not find OpenAI client constructor to patch")

if changed:
    with open(filepath, 'w') as f:
        f.write(code)
    print(f"  DONE — file written")
else:
    print(f"  SKIP — all patches already applied")

# Signal to shell: 0 = patched, 2 = already patched
sys.exit(0 if changed else 2)
PYTHON_PATCH

    rc=$?
    set -e
    if [ $rc -eq 0 ]; then
        PATCHED=$((PATCHED + 1))
    else
        SKIPPED=$((SKIPPED + 1))
    fi
    echo ""
done

echo "=== Summary: $PATCHED patched, $SKIPPED already up-to-date ==="
