# Python coding practices

- Annotate all code. Do not use casts or `Any`.
- Prefer immutable objects, composition over inheritance, early returns, and fail-fast behavior.
- Follow the Law of Demeter: avoid reaching through collaborators such as `object.attribute.method()` when the owning object should expose the behavior itself.
- Extract named variables for compound conditions and single-branch multiline conditions. Conditions in an exhaustive `if`/`elif` chain or `match` may remain inline when naming them would obscure the alternatives.

  ```python
  can_access = user.is_active and user.has_access and not user.is_banned
  if can_access:
      grant_access()
  ```

- Prefer exhaustive conditional branches and matches so new variants cannot silently fall through. Do not use `else` as a catch-all for non-binary alternatives.
- When a function operates on one class of domain object, prefer a method on that class unless it clearly belongs at module level.
- Prefer invalidating upstream rather than downstream.
