---
name: coding-practices
description: Apply personal implementation, design, and testing practices. Use before writing, changing, or reviewing code; for Python work also read references/python.md.
---

# Coding practices

For Python work, read [references/python.md](references/python.md) before proceeding. Follow project-specific constraints and tooling instructions.

## Design and change scope

- Start from existing domain objects, policies, helpers, and configuration. Add an abstraction when it owns a distinct invariant, lifecycle, or failure boundary.
- Prefer deriving values from authoritative state. Persist additional state only when required facts or history cannot otherwise be recovered.
- Before adding persisted state or widening contracts, show the concrete behavior existing machinery cannot support; resolve consequential ambiguity.
- Establish each invariant at its owning boundary and expose a clear typed result. Downstream code uses that contract; revalidation targets facts that can actually change between validation and use.
- Implement requested behavior at the responsible layer. Preserve unrelated behavior and contracts; separate independent cleanup or redesign.
- Prefer immutable objects, early returns, composition over inheritance, and boring code over clever code. Fail fast; use CQRS method names that distinguish queries from commands.
- Name things by their domain meaning and actual behavior. Comments explain current contracts, surprising constraints, and why a simpler-looking alternative would be wrong. Do not narrate change progress.

## Functional Core, Imperative Shell

Separate business logic from I/O and side effects:

- **Functional Core:** pure business rules, calculations, and data transforms. No database access, network, state mutation, or other I/O. Same inputs produce the same outputs.
- **Imperative Shell:** gather external data, pass it to the core, then execute the resulting side effects: database writes, API calls, or UI rendering.

Domain logic should be unit-testable without mocks. Do not extract pass-through functions solely to make tests easier; give each module meaningful behavior and ownership.

## Tests

- Before adding a test, name the changed invariant and smallest useful public interface that exposes it. Extend existing focused tests; avoid re-proving unchanged plumbing.
- Prefer testing the functional core with real data or stubs, without mocks. Mock only external I/O when needed.
- Assert observable behavior, not private calls, implementation details, or call counts alone. Tests must survive behavior-preserving refactors.
- Broaden the test surface when the changed invariant spans orchestration or I/O; do not ignore that behavior merely because pure-core tests are simpler.
- Cover significant behavior changes, not every unchanged retrieval, locking, or save step. Many mocks usually signal that the test surface is too broad or the design needs a better interface.

## Related skills

- For structural design or interface exploration, read `../codebase-design/SKILL.md`. Use its deep-module guidance alongside these implementation practices; do not duplicate it here.
- Use domain-modeling, grilling, architecture scans, and Plannotator workflows only when requested or needed for an already agreed workflow. Ordinary coding does not authorize documentation creation, a broad redesign, or opening review UI.
