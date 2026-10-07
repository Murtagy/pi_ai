
Do not post GitHub or Asana comments unless asked to.
For small changes prefer trees in /tmp (lt 150 lines)

### Local review
Follow the `local-review` skill for local development and Plannotator review workflow. It covers branch setup, planning larger changes, acting on review feedback, and recording decisions in `local/docs/<feature-slug>/plan.md` and `qa.md`.


## PR description
```
Tweetsize description

## Summary (bullet list, critical bullets bold)
Do not mention validations like tests run which are part of CI already (type checking, linting, formatting, unit tests, etc).

## Dependencies (no section if none)


Task - <put link here> (no section if none)


```

## Code location
libdohop - ~/dohop/libdohop shared lib
doclient - ~/dohop/doclient client/frontend
robots - ~/dohop/robots integrations run by bs2 and k3
