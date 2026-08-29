# C!MUST — Quality Gates

One command, run the same way locally and in CI. The tools differ by stack; the gate doesn't.

```
verify
├── lint
├── typecheck
├── test
└── build
```

**Pass or fail. No partial credit, no "close enough."** If it fails, the change isn't done.

## Your stack (MingleMate / C!MUST publication — JS/TS, Vite, Supabase)

`package.json`:
```json
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "vite build",
    "verify": "npm run lint && npm run typecheck && npm run test && npm run build"
  }
}
```

Run it with:
```
npm run verify
```

For Supabase Edge Functions (Deno, not Node — `npm run verify` above won't touch these):
```
deno test --allow-env --allow-net supabase/functions/
```
Add this as a second CI job, or fold it into `verify` with a Deno check if all your functions live in one folder.

## Reference table for other stacks (for when C!MUST moves beyond this project)

| Stack | Lint | Typecheck | Test | Build |
|---|---|---|---|---|
| JS/TS | ESLint | tsc | Vitest / Jest | vite/webpack/tsc |
| Python | Ruff | mypy | pytest | — |
| Go | gofmt | go vet | go test | go build |
| Rust | cargo fmt --check | — | cargo test | cargo build |

## What "test" means at v0.1 — don't chase coverage

Test by risk, not by percentage:

1. **Tier 1 — money/security/data**: payment unlock flow, auth, RLS-gated data access. Get these covered first.
2. **Tier 2 — core function**: match generation, registration parsing.
3. **Tier 3 — supporting features.**
4. **Tier 4 — cosmetic.** Don't spend time here yet.

One Playwright test for the Tier 1 payment-unlock path is worth more right now than ten unit tests on Tier 4 UI.
