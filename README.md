# pi_ai

Personal Pi extensions, skills, and instruction files.

## Skills

Personal workflows:

- `coding-practices`: implementation scope, functional core / imperative shell, and behavior-focused testing. Loads its Python reference for Python work.
- `pr-description`: concise PR descriptions with optional dependencies, bug-fix evidence, and task links.
- `local-review`: local development and Plannotator review workflow, used when review is requested or already active.

Adapted from [Matt Pocock's skills repository](https://github.com/mattpocock/skills):

- [codebase-design](https://github.com/mattpocock/skills/tree/main/skills/engineering/codebase-design): deep-module design vocabulary and guidance.
- [grill-with-docs](https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs): design interviews with documentation.
- [grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling): decision-tree interviews to stress-test plans and ideas.
- [improve-codebase-architecture](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture): architecture scans, visual HTML reports, and guided deepening interviews.
- `domain-modeling`: domain terminology, glossaries, and ADRs, with explicit documentation permissions.

Original architecture/interview source snapshot: `6fd947921b935b7e1e69293a200400f0fdd5c15f`.
Each imported skill retains Matt Pocock's MIT license in its `LICENSE` file. Local adaptations use Pi file reads instead of a `Skill` tool, support direct exploration when sub-agents are unavailable, preserve project terminology, and respect documentation permissions.

### User-level installation

Skills live directly under `skills/`, with symlinks in Pi's global user skills directory. Available across projects; no project-specific installation needed.

```bash
mkdir -p ~/.pi/agent/skills
for skill in coding-practices pr-description local-review codebase-design domain-modeling grill-with-docs grilling improve-codebase-architecture; do
  ln -s "$HOME/Dev/clones/pi_ai/skills/$skill" "$HOME/.pi/agent/skills/$skill"
done
```

Existing correct symlinks need no changes; preserve or resolve conflicting paths before installation. Run `/reload` in an existing Pi session after installation. Invoke any skill explicitly with `/skill:<name>`.

`grill-with-docs` and `improve-codebase-architecture` remain manual-only (`disable-model-invocation: true`). Ordinary coding does not start these workflows, create project documentation, or open Plannotator.

## Instruction files

- `.pi/agent/AGENTS.md`: small always-loaded permission and editing rules, plus explicit routing to coding and PR skills.
- `contexts/dohop/AGENTS.md`: Dohop repository locations, loaded only under `~/dohop`.
- Project `AGENTS.md` files retain repository commands, framework constraints, and domain-specific warnings.

After preserving any existing instruction files, link the tracked sources:

```bash
ln -s "$HOME/Dev/clones/pi_ai/.pi/agent/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
ln -s "$HOME/Dev/clones/pi_ai/contexts/dohop/AGENTS.md" "$HOME/dohop/AGENTS.md"
```

Pi discovers ancestor context files automatically. Skill descriptions support discovery, while the global instruction file explicitly requires loading coding practices before code work and the PR skill before drafting or editing a description. Run `/reload` after changing instructions or skills.
