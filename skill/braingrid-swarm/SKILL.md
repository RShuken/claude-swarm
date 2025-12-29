---
name: braingrid-swarm
description: Orchestrate Claude Code worker swarms driven by Braingrid requirements and tasks. Workers follow exact Braingrid PRD specifications instead of doing their own planning. Use for executing Braingrid requirements with parallel workers, status sync, and testing.
---

# Braingrid-Swarm Integration Skill

This skill combines the claude-swarm MCP server with Braingrid CLI to execute requirements using exact PRD specifications.

## Overview

**Key Difference from standard /swarm**: Instead of competitive planning, workers receive exact task specifications from Braingrid and follow them precisely.

### Integration Flow
```
Braingrid REQ → breakdown → tasks → Swarm Workers → Status Updates → Test → PR
```

## Quick Start Workflow

### Phase 1: Prepare the Requirement

```bash
# 1. Break down the requirement into tasks (takes 1-3 minutes)
braingrid requirement breakdown REQ-XX -p PROJ-3

# 2. Wait for task creation
sleep 60

# 3. Check if tasks exist
braingrid task list -r REQ-XX -p PROJ-3

# 4. If no tasks yet, wait and check again
sleep 30
braingrid task list -r REQ-XX -p PROJ-3

# 5. Review implementation plan (run breakdown again)
braingrid requirement breakdown REQ-XX -p PROJ-3

# 6. Wait for review completion
sleep 60
```

### Phase 2: Initialize Swarm with Braingrid Tasks

```bash
# 1. Get tasks in JSON format
braingrid task list -r REQ-XX -p PROJ-3 --format json

# 2. Update requirement status to IN_PROGRESS
braingrid requirement update REQ-XX -p PROJ-3 --status IN_PROGRESS
```

Then initialize the swarm:
```
Use orchestrator_init with:
- projectDir: /Users/shuken/AI/open-lit/openLiteracy
- taskDescription: [Copy the requirement name/description from Braingrid]
- existingFeatures: [Map each Braingrid TASK to a feature with FULL task content]
```

**CRITICAL**: Each feature description MUST include the complete task content:
- Goal
- Implementation Context (files to create)
- Implementation Steps
- Success Criteria
- Dependencies

### Phase 3: Execute Tasks Sequentially

For each task (respecting dependencies):

```bash
# 1. Update task status
braingrid task update TASK-XX -r REQ-XX -p PROJ-3 --status IN_PROGRESS

# 2. Get full task content
braingrid task show TASK-XX -p PROJ-3
```

Then start the worker:
```
Use start_worker with:
- featureId: [the feature ID from swarm]
- additionalContext: [Include complete task content from braingrid task show]
```

After worker completes:
```bash
# 3. Run tests
cd /Users/shuken/AI/open-lit/openLiteracy && npm run test

# 4. Mark task complete in braingrid
braingrid task update TASK-XX -r REQ-XX -p PROJ-3 --status COMPLETED

# 5. Mark feature complete in swarm
Use mark_complete with featureId, success: true
```

### Phase 4: Complete the Requirement

After all tasks complete:

```bash
# 1. Run full test suite
cd /Users/shuken/AI/open-lit/openLiteracy && npm run test:coverage

# 2. Commit all changes
Use commit_progress with message: "feat(REQ-XX): [requirement name]"

# 3. Create PR
# Use gh CLI or git push to create pull request

# 4. Update requirement status
braingrid requirement update REQ-XX -p PROJ-3 --status COMPLETED
```

## Worker Prompt Strategy

When creating features for the swarm, format each feature description like this:

```
BRAINGRID TASK: TASK-XX - [Task Title]

## Goal
[Copy from braingrid task show]

## Implementation Context
Files to Create/Modify:
[Copy from braingrid task show]

## Implementation Steps
[Copy numbered steps from braingrid task show]

## Success Criteria
[Copy from braingrid task show]

## Scope Constraint
Implement ONLY the deliverables listed above. Follow the implementation steps exactly.
```

## Handling Dependencies

Braingrid tasks have explicit dependencies (e.g., "Blocked by: 1, 2").

Map these to swarm dependencies:
```
Use set_dependencies with:
- featureId: "feature-3"
- dependsOn: ["feature-1", "feature-2"]
```

## Testing Configuration

Configure verification commands for the swarm:
```
Use configure_verification with:
- commands: ["npm run test", "npm run build"]
- runAfterEachFeature: true
```

## Status Mapping

| Swarm Status | Braingrid REQ Status | Braingrid Task Status |
|--------------|---------------------|----------------------|
| Session init | IN_PROGRESS | - |
| Worker started | - | IN_PROGRESS |
| Worker complete | - | COMPLETED |
| All complete | REVIEW/COMPLETED | - |

## Full Example Session

```
User: "Execute REQ-14 from Braingrid PROJ-3"

Step 1: Break down requirement
$ braingrid requirement breakdown REQ-14 -p PROJ-3
[Wait 60 seconds]
$ braingrid task list -r REQ-14 -p PROJ-3
[Shows 13 tasks]

Step 2: Review implementation plan
$ braingrid requirement breakdown REQ-14 -p PROJ-3
[Wait 60 seconds - AI reviews and may update tasks]

Step 3: Update REQ status
$ braingrid requirement update REQ-14 -p PROJ-3 --status IN_PROGRESS

Step 4: Initialize swarm with tasks as features
[Call orchestrator_init with 13 features, each containing full task content]

Step 5: Process Task 1 (no dependencies)
$ braingrid task update TASK-1 -r REQ-14 -p PROJ-3 --status IN_PROGRESS
[Call start_worker for feature-1]
[Sleep 180 seconds]
[Call check_worker]
[Worker completes]
$ npm run test
$ braingrid task update TASK-1 -r REQ-14 -p PROJ-3 --status COMPLETED
[Call mark_complete]
[Call commit_progress]

Step 6: Process Task 2 (depends on Task 1)
[Repeat for each task in dependency order]

Step 7: After all tasks complete
$ npm run test:coverage
[Create PR]
$ braingrid requirement update REQ-14 -p PROJ-3 --status COMPLETED
```

## Planned Requirements for PROJ-3 (openLiteracy)

| REQ ID | Name | Tasks |
|--------|------|-------|
| REQ-14 | Speech Recognition Benchmarking | 13 tasks |
| REQ-15 | Google Sheets Content | Needs breakdown |
| REQ-16 | Configure Google OAuth | Needs breakdown |
| REQ-17 | Production Deployment | Needs breakdown |
| REQ-18 | Manual Testing | Needs breakdown |
| REQ-19 | Student Transfer Email | Needs breakdown |
| REQ-20 | Fix Exit Ticket History | Needs breakdown |
| REQ-21 | Password Reset Request | Needs breakdown |
| REQ-22 | Notify Administrators | Needs breakdown |
| REQ-23 | Fix Lesson Assignment | Needs breakdown |
| REQ-24 | Add Pronouns Dropdown | Needs breakdown |
| REQ-25 | Display Mastered Skills | Needs breakdown |

## Troubleshooting

### Task breakdown takes too long
- Wait up to 3 minutes for complex requirements
- Check status with `braingrid task list -r REQ-XX -p PROJ-3`

### Worker doesn't follow task specs
- Ensure full task content is in the feature description
- Use `send_worker_message` to remind worker of exact specs

### Tests fail after task completion
- Don't mark task COMPLETED in braingrid until tests pass
- Use `retry_feature` in swarm to restart

### Need to skip a task
- Update task status to CANCELLED in braingrid
- Remove from swarm features or mark as skipped
