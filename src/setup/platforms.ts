/**
 * Platform Detection and Abstraction Layer
 *
 * Detects the Git platform from the remote origin URL and provides
 * platform-specific configuration for CI/CD, issue templates, and automation.
 *
 * Supported platforms:
 * - GitHub (github.com)
 * - GitLab (gitlab.com and self-hosted)
 * - Gitea (various hosts)
 * - Bitbucket (bitbucket.org)
 * - Azure DevOps (dev.azure.com)
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Supported Git platforms
 */
export type Platform =
  | "github"
  | "gitlab"
  | "gitea"
  | "bitbucket"
  | "azure"
  | "unknown";

/**
 * Platform-specific configuration
 */
export interface PlatformConfig {
  /** Human-readable platform name */
  name: string;
  /** Path to CI/CD configuration file(s) */
  ciConfigPath: string;
  /** Path to issue template directory or file */
  issueTemplatePath: string;
  /** Whether the platform supports GitHub Actions-style workflows */
  hasActions: boolean;
  /** Default branch name convention */
  defaultBranch: string;
  /** PR/MR terminology */
  mergeRequestTerm: "pull request" | "merge request";
}

/**
 * Platform configurations mapping
 */
export const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = {
  github: {
    name: "GitHub",
    ciConfigPath: ".github/workflows",
    issueTemplatePath: ".github/ISSUE_TEMPLATE",
    hasActions: true,
    defaultBranch: "main",
    mergeRequestTerm: "pull request",
  },
  gitlab: {
    name: "GitLab",
    ciConfigPath: ".gitlab-ci.yml",
    issueTemplatePath: ".gitlab/issue_templates",
    hasActions: false,
    defaultBranch: "main",
    mergeRequestTerm: "merge request",
  },
  gitea: {
    name: "Gitea",
    ciConfigPath: ".gitea/workflows",
    issueTemplatePath: ".gitea/issue_template",
    hasActions: true, // Gitea supports GitHub Actions-compatible workflows
    defaultBranch: "main",
    mergeRequestTerm: "pull request",
  },
  bitbucket: {
    name: "Bitbucket",
    ciConfigPath: "bitbucket-pipelines.yml",
    issueTemplatePath: ".bitbucket/issue_templates",
    hasActions: false,
    defaultBranch: "main",
    mergeRequestTerm: "pull request",
  },
  azure: {
    name: "Azure DevOps",
    ciConfigPath: "azure-pipelines.yml",
    issueTemplatePath: ".azuredevops/issue_templates",
    hasActions: false,
    defaultBranch: "main",
    mergeRequestTerm: "pull request",
  },
  unknown: {
    name: "Unknown",
    ciConfigPath: ".ci",
    issueTemplatePath: ".issue_templates",
    hasActions: false,
    defaultBranch: "main",
    mergeRequestTerm: "pull request",
  },
};

/**
 * Platform detection patterns
 * Each pattern is tested against the git remote origin URL
 */
interface PlatformPattern {
  platform: Platform;
  patterns: RegExp[];
}

const PLATFORM_PATTERNS: PlatformPattern[] = [
  {
    platform: "github",
    patterns: [
      /github\.com[:/]/i,
      /github\.io[:/]/i,
    ],
  },
  {
    platform: "gitlab",
    patterns: [
      /gitlab\.com[:/]/i,
      /gitlab\.[a-z]+\.[a-z]+[:/]/i, // Self-hosted GitLab instances
    ],
  },
  {
    platform: "gitea",
    patterns: [
      /gitea\./i,
      /codeberg\.org[:/]/i, // Codeberg uses Gitea
      /forgejo\./i, // Forgejo is a Gitea fork
      /tea\./i, // Common Gitea hosting pattern
    ],
  },
  {
    platform: "bitbucket",
    patterns: [
      /bitbucket\.org[:/]/i,
      /bitbucket\.[a-z]+\.[a-z]+[:/]/i, // Self-hosted Bitbucket
    ],
  },
  {
    platform: "azure",
    patterns: [
      /dev\.azure\.com[:/]/i,
      /visualstudio\.com[:/]/i, // Legacy Azure DevOps URL
      /azure\.com.*\/_git\//i,
    ],
  },
];

/**
 * Detect the Git platform from the remote origin URL
 *
 * @param projectDir - Absolute path to the project directory
 * @returns The detected platform or 'unknown' if not recognized
 */
export async function detectPlatform(projectDir: string): Promise<Platform> {
  try {
    // Get the git remote origin URL
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: projectDir,
    });

    const remoteUrl = stdout.trim();

    if (!remoteUrl) {
      return "unknown";
    }

    // Match against known platform patterns
    for (const { platform, patterns } of PLATFORM_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(remoteUrl)) {
          return platform;
        }
      }
    }

    return "unknown";
  } catch {
    // Git command failed (no remote, not a git repo, etc.)
    return "unknown";
  }
}

/**
 * Get the platform configuration for a detected platform
 *
 * @param platform - The detected platform
 * @returns The platform configuration
 */
export function getPlatformConfig(platform: Platform): PlatformConfig {
  return PLATFORM_CONFIGS[platform];
}

/**
 * Detect platform and return its configuration in one call
 *
 * @param projectDir - Absolute path to the project directory
 * @returns Object containing the detected platform and its configuration
 */
export async function detectPlatformWithConfig(
  projectDir: string
): Promise<{ platform: Platform; config: PlatformConfig }> {
  const platform = await detectPlatform(projectDir);
  const config = getPlatformConfig(platform);
  return { platform, config };
}

// ============================================================================
// Platform-Specific Issue Templates
// ============================================================================

/**
 * Get platform-specific issue templates
 *
 * Each platform has its own format for issue templates:
 * - GitHub: YAML forms in .github/ISSUE_TEMPLATE/
 * - GitLab: Markdown files in .gitlab/issue_templates/
 * - Gitea: Markdown files in .gitea/issue_template/
 * - Bitbucket: JSON files (limited template support)
 * - Azure DevOps: XML work item templates
 *
 * @param platform - The Git platform
 * @returns Record of filename to template content
 */
export function getPlatformIssueTemplates(platform: Platform): Record<string, string> {
  switch (platform) {
    case "github":
      return getGitHubIssueTemplates();
    case "gitlab":
      return getGitLabIssueTemplates();
    case "gitea":
      return getGiteaIssueTemplates();
    case "bitbucket":
      return getBitbucketIssueTemplates();
    case "azure":
      return getAzureWorkItemTemplates();
    default:
      return getGitHubIssueTemplates();
  }
}

function getGitHubIssueTemplates(): Record<string, string> {
  return {
    ".github/ISSUE_TEMPLATE/bug.yml": `name: Bug Report
description: Report a bug or unexpected behavior
title: "[Bug]: "
labels: ["bug", "triage"]
assignees: []

body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to fill out this bug report!

  - type: textarea
    id: description
    attributes:
      label: Describe the bug
      description: A clear and concise description of what the bug is.
      placeholder: Tell us what you see!
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      description: Steps to reproduce the behavior.
      placeholder: |
        1. Go to '...'
        2. Click on '...'
        3. See error
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: A clear and concise description of what you expected to happen.
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: Version
      description: What version are you running?
      placeholder: "v1.0.0"
    validations:
      required: true
`,
    ".github/ISSUE_TEMPLATE/feature.yml": `name: Feature Request
description: Suggest an idea for this project
title: "[Feature]: "
labels: ["enhancement", "triage"]
assignees: []

body:
  - type: markdown
    attributes:
      value: |
        Thank you for suggesting a feature! Please fill out the form below.

  - type: textarea
    id: problem
    attributes:
      label: Is your feature request related to a problem?
      description: A clear and concise description of what the problem is.
      placeholder: I'm always frustrated when...

  - type: textarea
    id: solution
    attributes:
      label: Describe the solution you'd like
      description: A clear and concise description of what you want to happen.
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Describe alternatives you've considered
      description: A clear and concise description of any alternative solutions.

  - type: checkboxes
    id: contribution
    attributes:
      label: Contribution
      options:
        - label: I would be willing to help implement this feature
`,
    ".github/ISSUE_TEMPLATE/config.yml": `blank_issues_enabled: false
contact_links:
  - name: Discussions
    url: https://github.com/OWNER/REPO/discussions
    about: Ask questions and discuss ideas
`,
  };
}

function getGitLabIssueTemplates(): Record<string, string> {
  return {
    ".gitlab/issue_templates/Bug.md": `## Summary
<!-- A clear and concise description of what the bug is. -->

## Steps to Reproduce
1.
2.
3.

## Expected Behavior
<!-- What you expected to happen. -->

## Actual Behavior
<!-- What actually happened. -->

## Environment
- Version:
- OS:
- Browser (if applicable):

## Logs/Screenshots
<!-- If applicable, add logs or screenshots to help explain your problem. -->

/label ~bug ~triage
`,
    ".gitlab/issue_templates/Feature.md": `## Problem Statement
<!-- Is your feature request related to a problem? Please describe. -->

## Proposed Solution
<!-- A clear and concise description of what you want to happen. -->

## Alternatives Considered
<!-- Describe any alternative solutions or features you've considered. -->

## Additional Context
<!-- Add any other context about the feature request here. -->

## Implementation Notes
<!-- Optional: Any technical considerations or suggestions for implementation. -->

/label ~enhancement ~triage
`,
    ".gitlab/issue_templates/Default.md": `## Description
<!-- Please describe the issue or request in detail. -->

## Details
<!-- Add any additional context, screenshots, or information. -->

`,
  };
}

function getGiteaIssueTemplates(): Record<string, string> {
  return {
    ".gitea/issue_template/bug.md": `---
name: Bug Report
about: Report a bug or unexpected behavior
labels: bug, triage
---

## Description
<!-- A clear and concise description of what the bug is. -->

## Steps to Reproduce
1.
2.
3.

## Expected Behavior
<!-- What you expected to happen. -->

## Actual Behavior
<!-- What actually happened. -->

## Environment
- Version:
- OS:

## Additional Context
<!-- Any other context about the problem. -->
`,
    ".gitea/issue_template/feature.md": `---
name: Feature Request
about: Suggest an idea for this project
labels: enhancement
---

## Problem
<!-- Is your feature request related to a problem? -->

## Proposed Solution
<!-- Describe the solution you'd like. -->

## Alternatives
<!-- Any alternatives you've considered. -->

## Additional Context
<!-- Any other context about the feature request. -->
`,
  };
}

function getBitbucketIssueTemplates(): Record<string, string> {
  // Bitbucket has limited issue template support
  // These are basic markdown templates that can be used as reference
  return {
    ".bitbucket/issue_templates/bug.md": `# Bug Report

## Description
<!-- A clear and concise description of what the bug is. -->

## Steps to Reproduce
1.
2.
3.

## Expected Behavior
<!-- What you expected to happen. -->

## Actual Behavior
<!-- What actually happened. -->

## Environment
- Version:
- OS:

## Additional Context
<!-- Any other context about the problem here. -->
`,
    ".bitbucket/issue_templates/feature.md": `# Feature Request

## Problem
<!-- Is your feature request related to a problem? Please describe. -->

## Proposed Solution
<!-- A clear and concise description of what you want to happen. -->

## Alternatives Considered
<!-- Any alternative solutions or features you've considered. -->

## Additional Context
<!-- Any other context about the feature request here. -->
`,
  };
}

function getAzureWorkItemTemplates(): Record<string, string> {
  // Azure DevOps uses XML for work item templates, but we'll provide markdown templates
  // that can be used as default descriptions for work items
  return {
    ".azuredevops/work_item_templates/bug.md": `# Bug Report

## Repro Steps
1.
2.
3.

## Expected Behavior
<!-- What you expected to happen. -->

## Actual Behavior
<!-- What actually happened. -->

## System Info
- Version:
- Environment:

## Acceptance Criteria
- [ ] Bug is fixed
- [ ] Regression tests added
- [ ] Documentation updated (if applicable)
`,
    ".azuredevops/work_item_templates/user_story.md": `# User Story

## As a [type of user]
I want [an action or feature]
So that [benefit/value]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Definition of Done
- [ ] Code complete
- [ ] Unit tests passing
- [ ] Code review completed
- [ ] Documentation updated

## Notes
<!-- Additional context or technical notes. -->
`,
    ".azuredevops/work_item_templates/task.md": `# Task

## Description
<!-- What needs to be done. -->

## Details
<!-- Implementation details or technical notes. -->

## Acceptance Criteria
- [ ] Task completed as specified
- [ ] Tests added/updated
- [ ] Documentation updated (if applicable)
`,
  };
}
