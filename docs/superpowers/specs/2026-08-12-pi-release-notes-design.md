# Pi release-note generation

## Goal

Generate draft changelog entries through Pi rather than Codex during the release workflow.

## Scope

- `scripts/generate-changelog.ts` will synchronously run `pi -p <prompt>`.
- The existing prompt, strict JSON validation, `--yes` behavior, and interactive `$EDITOR` review remain unchanged.
- Codex-specific helper names, tests, errors, and `justfile` comments will refer to Pi.

## Error handling

If Pi is unavailable, unauthenticated, or exits unsuccessfully, the generator will fail with an actionable error naming the attempted `pi -p` command. Invalid output continues to fail JSON validation before `changelog.json` is changed.

## Validation

Unit tests will assert the Pi command arguments and retain coverage for prompt composition and entry parsing. The focused Vitest test suite and TypeScript typecheck will run after the change.
