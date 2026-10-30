# Agent instructions

## Permissions and edits

- Do not post GitHub or Asana comments unless asked.
- Do not commit, push, or create documentation unless asked.
- Preserve user edits to files and PR descriptions. Re-read current content and patch narrowly.
- For small changes (fewer than 150 changed lines), prefer worktrees in `/tmp`.
- Bypass unrelated broken hooks only; report the bypass. Do not bypass failures caused by the requested changes.
- Skill instructions do not authorize extra scope or override project-specific constraints.

## Skill routing

- Before writing, changing, or reviewing code, read `~/.pi/agent/skills/coding-practices/SKILL.md`.
- Before drafting or editing PR descriptions, read `~/.pi/agent/skills/pr-description/SKILL.md`.
- Use `local-review` when a Plannotator review workflow is requested or already active; ordinary coding does not require opening review UI.
