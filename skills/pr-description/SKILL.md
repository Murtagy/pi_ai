---
name: pr-description
description: Draft or edit pull request descriptions using the personal PR format. Use whenever creating, rewriting, or updating a PR description, including descriptions requested in ordinary conversation.
---

# PR description

Read the relevant diff and any existing PR description before writing. Preserve user edits and patch narrowly when updating an existing description.

## Content

- Start with a tweet-sized description of the change.
- Keep the implementation summary short: important details only, as bullets. Bold critical bullets.
- Omit routine CI validation lists: type checking, linting, formatting, and unit-test runs.
- Include dependencies only when present; omit the section otherwise.
- For bug fixes, include concrete before/after evidence. This is regression evidence, not a generic validation checklist.
  - Prefer screenshots for visual changes when the environment supports them.
  - Otherwise use execution-based evidence: the exact reproduction or regression test, before/after results, and concise pseudocode when useful.
  - Do not invent evidence or imply that checks were executed when they were not. State when evidence is unavailable.
- End with `Task - <link>` when a task link exists; omit the line otherwise.

## Template

Omit optional sections when they do not apply. Replace placeholders; do not leave instructions in the published description.

```markdown
<Tweet-sized description>

## Implementation summary
- <Important implementation detail>
- **<Critical implementation detail>**

## Dependencies
<Dependencies, if any>

## Evidence
<For bug fixes: concrete reproduction, before/after results, screenshots, or execution output>

Task - <link>
```
