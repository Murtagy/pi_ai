# Agent instructions

Keep it simple. Make the smallest correct change for the agreed scenario. When new edge cases or conditions are discovered - assess how much extra code is added to handle that case, first make the simple flow and mention the future case separatelly. Explain them and implement after agreement gathered on handling it.

At fixing: fix the root cause rather than masking symptoms. Before patching, trace the failure to its source and check whether an existing mechanism or a small, task-scoped simplification can resolve it consistently. Prefer that approach over duplicated logic, ad hoc workarounds, or unnecessary special cases. Keep refactoring proportional to the fix; if the root cause requires changes outside the authorized scope, explain the boundary and propose the next step. Label any temporary mitigation explicitly.

Prefer checking the sources over knowledge from model.

Tell what was not possible to check if something was not available.

Before opening a pull request - first request review, then open local review, only then open a PR (unless instructed differently). Always open PR in the draft state.

Use plain technical language in plans and qa.

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
- In order to query logs from the deployed Python code of metabooking/robots/libdohop - see ~/dohop/libdohop/libdohop/ai_tools/logs/ai_debug.txt
