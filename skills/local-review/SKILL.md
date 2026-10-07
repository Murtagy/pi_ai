---
name: local-review
description: Guides local development and Plannotator review workflows, including planning larger changes and acting on review feedback.
---

# Local review

Use this workflow for local code changes that need Plannotator review.

## Before implementation

1. Explore the codebase and understand the request.
2. Ensure work is on a new branch before changing files.
3. For unresolved design decisions or multiple architectural options, explore options and write a plan for review before implementing. Keep the plan under `local/docs/<feature-slug>/plan.md`.
4. For clear changes, including mechanical moves, implement directly regardless of diff size.

## Review

1. Stage the intended changes and open a Plannotator review.
2. Treat a submitted Plannotator review as authorization to act on clear feedback. Validate each finding against the code; do not assume findings are correct.
3. During an active review, implement clear requested revisions before presenting the next code review. Use plan-first review for unresolved design decisions, not mechanical moves or diff size alone. When one item needs clarification, ask a focused question and continue independent, actionable items.
4. Record important decisions in `local/docs/<feature-slug>/plan.md`. Record user questions and answers in `local/docs/<feature-slug>/qa.md`. Report verdicts and answers in `qa.md`.
5. Local plan and QA files may be committed to the branch to make review decisions visible. Do not push these files to the remote.
6. Open next review session or proceed to further instructions.


Keep the plan assertive - what we do, rather that what we don't do. The architectural choises (of not doing something) can we written in a separate section.

While Plannotator is involved, conduct subsequent review discussion through Plannotator.

## Wait for review in Pi

Launch each interactive Plannotator `review` or `annotate` in a foreground Bash call with the `timeout` field omitted entirely—not `0` or a large number. Keep that call active until the reviewer submits, approves, or dismisses; then consume the returned decision immediately. Run timed checks in separate calls. This takes precedence over the Plannotator reference’s long-timeout/background alternatives.

```json
{
  "command": "plannotator review --git --diff-type staged --json"
}
```

## Review scope

Review plan and QA incrementally: after first presentation, show only changes since the last acknowledged round. Review code against explicit per-file acceptance of the presented content. Previously shown does not mean accepted. Unchanged accepted files stay out of subsequent rounds; changed files return for review. Keep full context available on request.

Update existing `plan.md` when goals, scope, approach, or invariants change. Record new questions and decisions concisely in existing `qa.md`, usually one sentence per item. For mechanical edits, leave plan unchanged and present code diff, adding a brief QA answer when needed. Reuse stable document paths; present actual document changes since last acknowledged round. Keep validation logs and session bookkeeping outside review documents. When changing the plan - present the changes to it for review, unless there is a clear small change to the plan as a part of plan.md, not as a separate file.

Before opening each review, verify its actual contents include all new answers, verdicts, and plan changes since the last acknowledged document review. Present these as document deltas alongside code, or through a consecutive document review. Advance the document baseline only for versions actually presented in a submitted review; retain unpresented changes for the next round.
