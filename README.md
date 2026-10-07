# pi_ai

Personal Pi extensions and skills.

## Skills

These skills were copied from [Matt Pocock's skills repository](https://github.com/mattpocock/skills), preserving upstream contents and supporting files:

- [codebase-design](https://github.com/mattpocock/skills/tree/main/skills/engineering/codebase-design): deep-module design vocabulary and guidance.
- [grill-with-docs](https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs): design interviews with documentation.
- [grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling): decision-tree interviews to stress-test plans and ideas.
- [improve-codebase-architecture](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture): architecture scans, visual HTML reports, and guided deepening interviews.

Source snapshot: `6fd947921b935b7e1e69293a200400f0fdd5c15f`.
Each copied skill includes Matt Pocock's MIT license in its `LICENSE` file.

### User-level installation

Skills live directly under `skills/`, with symlinks in Pi's global user skills directory. Available across projects; no project-specific installation needed.

```bash
mkdir -p ~/.pi/agent/skills
for skill in codebase-design grill-with-docs grilling improve-codebase-architecture; do
  ln -s "$HOME/Dev/clones/pi_ai/skills/$skill" "$HOME/.pi/agent/skills/$skill"
done
```

Run `/reload` in an existing Pi session after installation. Invoke explicitly with `/skill:codebase-design`, `/skill:grill-with-docs`, `/skill:grilling`, or `/skill:improve-codebase-architecture`.

**Upstream compatibility:** `grill-with-docs` and `improve-codebase-architecture` disable automatic model invocation and instruct the agent to call a `Skill` tool for other skills, including `domain-modeling`. Pi loads skills through file reads instead; `domain-modeling` is not included in this installation. Upstream copies are unchanged and require that additional skill plus a Pi-compatible invocation approach before their full workflows can run. `improve-codebase-architecture` also requests sub-agents, which require an available sub-agent extension or an adapted exploration workflow.
