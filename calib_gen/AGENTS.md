# calib_gen — Agent instructions

## Scope

Python package **`calib_gen`** lives directly under **[`calib_gen/`](./)** (flat layout — same convention as `autoabsmap` and `pairing`). Camera **calibration bbox** generation, deduplication, and synthetic fill. R&D code lives only in [`calib_gen_rd/`](calib_gen_rd/) — reference for parity tests; **do not import** `calib_gen_rd` from production `calib_gen`.

## Docs

- Architecture: [`plan_architecture.md`](plan_architecture.md)
- Product / UX: [`docs/calib_generator.md`](docs/calib_generator.md)

## Monorepo

- Shared venv: repo root [`.venv`](../.venv) and [`../requirements.txt`](../requirements.txt).
- HTTP: [`../autocalib-api`](../autocalib-api) will expose `/api/v1/calib/*` when wired.
- Frontend Calib workspace: [`../autocalib-frontend/plan_architecture.md`](../autocalib-frontend/plan_architecture.md).

## Rules

- Same as root [`../AGENTS.md`](../AGENTS.md): Python 3.11+, Pydantic at boundaries, `logging` not `print()`, no imports from `absolutemap-gen` / R&D into production packages unless explicitly for golden tests.
