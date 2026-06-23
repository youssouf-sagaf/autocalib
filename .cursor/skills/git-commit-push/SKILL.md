---
name: git-commit-push
description: >-
  Stage changes, write a conventional commit message from the diff, commit, and
  push to origin. Use when the user asks to commit, push, "git commit", "commit
  et push", save work to GitHub, or publish branch changes.
---

# Git commit and push

Only run this workflow when the user **explicitly** asks to commit and/or push. If unclear, ask first.

## Git safety (never break these)

- NEVER update `git config`
- NEVER run destructive commands (`push --force`, `hard reset`, etc.) unless the user explicitly requests them
- NEVER skip hooks (`--no-verify`, `--no-gpg-sign`, etc.) unless explicitly requested
- NEVER force-push to `main` / `master` — warn if requested
- Avoid `git commit --amend` unless ALL are true:
  1. User requested amend, OR pre-commit hook modified files after a successful commit you made
  2. HEAD commit was created by you in this conversation (`git log -1 --format='%an %ae'`)
  3. Commit has NOT been pushed (`git status` does not show branch ahead of remote only after push)
- If commit **failed** or was **rejected by a hook**: fix and create a **new** commit — never amend
- If already pushed to remote: never amend unless user explicitly requests (needs force push)
- Do not commit `.env`, credentials, secrets, or `.venv` — warn if the user asked to include them

## Step 1 — Inspect (run in parallel)

```bash
git status
git diff
git diff --staged
git log -5 --oneline
git branch -vv
```

If pushing: confirm tracking branch and whether local is ahead/behind `origin`.

## Step 2 — Draft the commit message

- Read **all** changes to be included (staged + unstaged the user wants committed)
- Match recent style: `type(scope): short summary` then optional body (1–2 sentences, **why** not just what)
- Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Accurate verbs: `add` = new feature, `fix` = bug, `update` = enhancement
- Do not stage unrelated files

## Step 3 — Commit (sequential)

```bash
git add <paths>   # or git add -A when appropriate
git commit -m "$(cat <<'EOF'
type(scope): summary line

Optional body explaining why.

EOF
)"
git status
```

If the hook fails: fix the issue, then **new** commit (no amend unless amend rules above apply).

## Step 4 — Push (only if requested)

```bash
git push -u origin HEAD   # first push of branch
# or
git push
```

Return the remote URL or commit hash when done. Do not push unless the user asked to push.

## Empty / nothing to commit

If working tree is clean and nothing untracked to add: report that — do **not** create an empty commit.

## Examples (this repo)

```
feat(frontend): parse GPS coordinates in map search bar

Allow paste and Enter on lat,lng and Google Maps URLs without Mapbox geocoding.
```

```
fix(b2b): scope slot deletes to crop ROIs only

Prevent mass DELETE on save when no mapping crops are drawn.
```
