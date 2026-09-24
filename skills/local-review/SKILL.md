---
name: local-review
description: Guides local development and Plannotator review workflows, including planning larger changes and acting on review feedback.
---

# Local review

Use this workflow for local code changes that need Plannotator review.

## Before implementation

1. Explore the codebase and understand the request.
2. Ensure work is on a new branch before changing files.
3. For changes over 150 lines or with multiple architectural options, explore options and write a plan for review before implementing. Keep the plan under `local/docs/<feature-slug>/plan.md`.
4. For smaller, clear changes, implement directly.

## Review

1. Stage the intended changes and open a Plannotator review.
2. Treat a submitted Plannotator review as authorization to act on clear feedback. Validate each finding against the code; do not assume findings are correct.
3. Address direct feedback and clear comments. Apply confirmed changes without waiting for a separate verdict-approval discussion. Ask only about genuine ambiguity.
4. Record important decisions in `local/docs/<feature-slug>/plan.md`. Record user questions and answers in `local/docs/<feature-slug>/qa.md`. Report verdicts and answers in `qa.md`.
5. Local plan and QA files may be committed to the branch to make review decisions visible. Do not push these files to the remote.
6. Open next review session or proceed to further instructions.

While Plannotator is involved, conduct subsequent review discussion through Plannotator. Do not open a verdict-approval gate.
