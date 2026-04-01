# absolutemap-gen

Geo-AI satellite parking pipeline tooling. This package targets **Python 3.10+**; development is pinned to **CPython 3.12.x** via pyenv.

## Python interpreter (pyenv)

Install [pyenv](https://github.com/pyenv/pyenv) (and any OS build prerequisites it documents). Then install a 3.12 release once per machine:

```bash
pyenv install 3.12.8
```

This repository pins the interpreter with **[`.python-version`](.python-version)** (currently `3.12.8`). From this directory, `python` resolves to that version automatically:

```bash
cd absolutemap-gen
python -V   # should report Python 3.12.x
```

Commit `.python-version` so teammates and CI use the same interpreter.

## Virtual environment (recommended)

Create an isolated environment and install dependencies only inside it:

```bash
cd absolutemap-gen
python -m venv .venv
source .venv/bin/activate   # zsh/bash; on Windows: .venv\Scripts\activate
python -V
pip install -U pip
pip install -e .
# Optional: YOLO / dev tools — pip install -e ".[detection]" or pip install -e ".[dev]"
```

Do **not** commit `.venv/`.

### Virtualenv vs. installing into the pyenv “global” interpreter

| Approach | Pros | Cons |
| -------- | ---- | ---- |
| **Virtualenv (`.venv`)** | Dependencies are scoped to this project; no clashes with other repos; easy to delete and recreate; matches typical CI and packaging workflows. | One extra activation step per shell session (or use direnv / editor integration). |
| **Global install into the pyenv version** (`python -m pip install …` with no venv, using the `3.12.8` shim) | No activation step; quick for one-off experiments. | Packages accumulate in that pyenv version and are shared by **every** project that uses `3.12.8`; version conflicts and accidental upgrades are common; harder to reproduce what this repo actually needs. |

**Recommendation:** use a **virtualenv** for day-to-day work and for anything you might share or run in CI. Reserve global installs into a pyenv version only for throwaway trials, and prefer a dedicated pyenv version if you must go that route.

## Environment variables

Copy `.env.example` to `.env` (when present) and set secrets locally. Never commit `.env`.
