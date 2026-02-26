---
name: claude-delegate
description: "Delegate complex tasks to Claude Code CLI for superior reasoning, research, analysis, and multi-step work. Use when: (1) deep research requiring multiple web searches and synthesis, (2) complex multi-step reasoning or analysis, (3) tasks requiring careful fact-checking or verification, (4) long document summarization or transformation, (5) system administration and diagnostics, (6) any task where quality matters more than speed. NOT for: simple greetings, casual chat, one-line answers, tasks already handled well by the current model."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "requires": { "bins": ["claude"] },
        "os": ["macos", "linux"],
        "always": true,
      },
  }
user-invocable: true
---

# Claude Code Delegate

Delegate tasks to **Claude Code CLI** (`claude -p`) for high-quality results. Claude Code is a full agentic system with web search, file management, bash execution, and deep reasoning.

## When to Delegate

**ALWAYS delegate** these task types to Claude Code — they exceed what the local model can reliably do:

- **Research**: "find out about X", "what's the latest on Y", "compare A vs B"
- **Analysis**: "analyze this data", "what does this mean", "evaluate these options"
- **Complex reasoning**: multi-step problems, planning, strategy, trade-off analysis
- **Writing**: drafting emails, articles, reports, documentation
- **Summarization**: long documents, articles, threads
- **Fact-checking**: verifying claims, cross-referencing sources
- **Math & logic**: calculations, proofs, data processing
- **System admin**: diagnosing issues, checking logs, fixing configs
- **File work**: processing, transforming, or searching through files in the workspace

**Do NOT delegate** these — handle them directly:

- Simple greetings and casual chat
- One-word or one-line factual answers you're confident about
- Emoji reactions, acknowledgments
- Status checks or simple lookups you can do yourself

## How to Delegate

Use `bash` with `pty:true` to run Claude Code. **Always use `--dangerously-skip-permissions`** since this runs unattended.

### General Task (most common)

```bash
bash pty:true timeout:300 command:"claude -p 'USER_TASK_HERE' --dangerously-skip-permissions"
```

### Research Task (with web access)

```bash
bash pty:true timeout:300 command:"claude -p 'Research: USER_TASK_HERE. Search the web, synthesize findings, and provide sources.' --dangerously-skip-permissions --allowedTools 'WebSearch WebFetch Read'"
```

### File/Workspace Task

```bash
bash pty:true timeout:300 workdir:"/path/to/project" command:"claude -p 'USER_TASK_HERE' --dangerously-skip-permissions --allowedTools 'Read Write Edit Glob Grep Bash'"
```

### Analysis Task

```bash
bash pty:true timeout:300 command:"claude -p 'Analyze the following and provide detailed insights: USER_TASK_HERE' --dangerously-skip-permissions --allowedTools 'WebSearch WebFetch Read'"
```

### System Admin Task

```bash
bash pty:true timeout:300 elevated:true command:"claude -p 'USER_TASK_HERE' --dangerously-skip-permissions --allowedTools 'Bash Read Glob Grep'"
```

## Important Rules

1. **Always use `pty:true`** — Claude Code is a terminal application
2. **Always use `--dangerously-skip-permissions`** — no human to approve permissions
3. **Set `timeout:300`** (5 min) for most tasks, `timeout:600` (10 min) for heavy research
4. **Pass the user's FULL message** as the prompt — don't summarize or rephrase
5. **Add context** if the user's message references prior conversation — prepend relevant context to the prompt
6. **Use `workdir`** when the task involves a specific project directory
7. **Return Claude's output directly** to the user — don't re-summarize unless the output is extremely long (>2000 chars), in which case summarize the key points

## Choosing the Right Tool Permissions

| Task Type        | `--allowedTools`                   |
| ---------------- | ---------------------------------- |
| General question | (omit — Claude picks)              |
| Research         | `"WebSearch WebFetch Read"`        |
| Coding           | `"Bash Read Write Edit Glob Grep"` |
| File analysis    | `"Read Glob Grep"`                 |
| System admin     | `"Bash Read Glob Grep"`            |
| Writing/analysis | `"WebSearch WebFetch"`             |
| Everything       | (omit — let Claude use all tools)  |

## Handling Long Output

If Claude's response exceeds what fits in a chat message:

1. Extract the key findings/answer
2. If the user needs the full output, save it to a file and share the path
3. Offer to elaborate on specific sections

## Error Handling

If Claude Code fails or times out:

- Report the error to the user
- Suggest breaking the task into smaller pieces
- Try again with a longer timeout if it was a timeout issue
- Fall back to handling the task directly if Claude Code is unavailable

## Examples

### User asks: "What are the pros and cons of Rust vs Go for building a web API?"

```bash
bash pty:true timeout:300 command:"claude -p 'What are the pros and cons of Rust vs Go for building a web API? Consider performance, developer experience, ecosystem, deployment, and learning curve. Provide a balanced comparison with concrete examples.' --dangerously-skip-permissions --allowedTools 'WebSearch WebFetch'"
```

### User asks: "Summarize the latest news about AI regulation in the EU"

```bash
bash pty:true timeout:300 command:"claude -p 'Search for and summarize the latest news about AI regulation in the EU. Focus on the AI Act implementation, recent developments, and what it means for developers. Include sources.' --dangerously-skip-permissions --allowedTools 'WebSearch WebFetch'"
```

### User asks: "Check why my server is running slow"

```bash
bash pty:true timeout:300 elevated:true command:"claude -p 'Diagnose why this Linux server might be running slow. Check CPU, memory, disk, network, and running processes. Identify the likely bottleneck and suggest fixes.' --dangerously-skip-permissions --allowedTools 'Bash Read Glob Grep'"
```

### User asks: "Help me plan a trip to Japan"

```bash
bash pty:true timeout:300 command:"claude -p 'Help plan a trip to Japan. Search for current travel info, suggest an itinerary, recommend areas to stay, transportation tips, and estimated costs. Make it practical and actionable.' --dangerously-skip-permissions --allowedTools 'WebSearch WebFetch'"
```

### User invokes: `/claude-delegate what is the mass of the sun in elephants`

```bash
bash pty:true timeout:120 command:"claude -p 'What is the mass of the sun expressed in elephants? Show your calculation step by step.' --dangerously-skip-permissions"
```
