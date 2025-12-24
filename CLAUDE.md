# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build      # Compile TypeScript and copy dashboard assets
npm run dev        # Watch mode for TypeScript compilation
npm start          # Run the compiled MCP server
npm run inspector  # Debug with MCP Inspector
```

## Architecture Overview

This is an MCP (Model Context Protocol) server that orchestrates parallel Claude Code worker swarms via tmux sessions. The pattern separates concerns between an orchestrator (which plans and monitors) and workers (which implement individual features).

### Core Components

**src/index.ts** - MCP server entry point and all tool definitions. Registers 20 MCP tools for session management, worker control, verification, and state access.

**src/state/manager.ts** - Persistent state management. Stores orchestrator state (features, workers, progress log) in `.claude/orchestrator/state.json`. Uses atomic file writes and Zod schema validation. Implements the "notebook pattern" with human-readable progress files.

**src/workers/manager.ts** - Manages Claude Code worker sessions via tmux. Each worker runs in isolation with prompts passed via files (not shell strings) to prevent injection. Includes completion monitoring, heartbeat tracking, and conflict analysis for parallel execution.

**src/dashboard/server.ts** - Express HTTP server providing REST API and SSE endpoints for real-time monitoring. Serves the dashboard UI at `http://localhost:3456`.

**src/utils/security.ts** - Input validation and sanitization. Validates project directories (prevents traversal), feature IDs, session names, and verification commands (allowlist only).

### Key Design Patterns

1. **Persistent State Outside Context** - State survives Claude's context compaction via the MCP server
2. **Worker Isolation** - Each worker runs in its own tmux session with controlled tool access
3. **Atomic File Operations** - State and progress files use write-to-temp-then-rename pattern
4. **Command Allowlist** - Only safe verification commands (npm test, pytest, etc.) can be executed

### State Files Created Per Project

- `.claude/orchestrator/state.json` - Main session state
- `.claude/orchestrator/feature_list.json` - Feature status
- `.claude/orchestrator/workers/*.prompt|.log|.done|.status` - Per-worker files
- `claude-progress.txt` - Human-readable progress log
- `init.sh` - Environment setup script

## MCP Tool Categories

**Session**: `orchestrator_init`, `orchestrator_status`, `orchestrator_reset`, `pause_session`, `resume_session`

**Workers**: `start_worker`, `start_parallel_workers`, `validate_workers`, `check_worker`, `check_all_workers`, `send_worker_message`

**Features**: `mark_complete`, `retry_feature`, `add_feature`, `set_dependencies`

**Utilities**: `run_verification`, `get_progress_log`, `get_session_stats`, `commit_progress`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `3456` | Dashboard HTTP port |
| `ENABLE_DASHBOARD` | `true` | Set to `false` to disable |

## Dependencies

Requires tmux for worker session management (`brew install tmux` on macOS).
