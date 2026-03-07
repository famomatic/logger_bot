# Repository Guidelines

## Response Workflow

Before answering implementation, design, or bug questions:

- Inspect the relevant source files first.
- Do not answer based on assumptions when code can be checked in-repo.
- If context is unclear, locate related modules using search (`rg`) and inspect them.

---

## Planning Requirement

Always start non-trivial work by creating and maintaining a **detailed plan**.

The plan acts as a working memory for the session and must remain updated during the task.

A valid plan must include:

- investigation targets (files, modules, or components to inspect)
- the current behavior and a root-cause hypothesis
- the intended change scope
- directly connected files that may also require modification
- exact verification steps
- conditions that would require revising the plan

Generic plans are not acceptable.

Invalid examples:

- inspect code
- apply fix
- run checks

Each step must be concrete enough to execute without guesswork.

Do not begin editing until the plan is specific enough to guide the task.

Plans are **provisional working notes**, not constraints.

If inspection or verification disproves earlier assumptions, revise the plan immediately.

---

## Task Classification

Before making changes, classify the task as one of:

- docs-only
- config-only
- env-only
- code
- cross-cutting

Choose verification based on that classification and avoid unrelated commands.

---

# Scope & Change Control

## Scope Detection

Before making code changes, determine the minimal scope required.

Classify the scope as one of:

- single function
- single file
- module
- cross-module

Prefer the smallest scope that fully solves the task.

If lint, build, or runtime verification reveals **directly connected breakage**, expand scope only as much as required to resolve it.

Files required to resolve compile errors, type errors, import failures, or runtime integration problems are considered **related files**.

Avoid modifying files that are clearly unrelated to the request.

---

## Protected Configuration Files

The following files are considered **locked configuration** and must never be modified unless explicitly instructed:

- `eslint.config.js`
- `tsconfig.json`

These files define project-wide linting and TypeScript behavior.

Agents must treat them as immutable and must not:

- modify
- rewrite
- regenerate
- reformat

them during normal tasks.

---

## Patch Minimalism

Changes must remain strictly related to the requested task.

Avoid:

- refactoring unrelated code
- renaming unrelated symbols
- reformatting untouched code
- architectural rewrites
- introducing new abstractions without necessity

Every changed line must have a clear relationship to the task.

However, if verification reveals breakage in **directly connected code**, fix only what is required to restore correct behavior.

---

## Defensive Code Policy

Avoid speculative defensive programming.

Do not introduce layered guards such as repeated `if` chains or excessive `try/catch` blocks unless they address a known failure mode.

However, a **single direct guard or error check is acceptable** when:

- preventing a concrete bug
- handling external input or API responses
- matching patterns already used in the codebase

The goal is to avoid defensive noise, not to prohibit legitimate safeguards.

---

## Request Handling

Do not refuse user requests unless the change would clearly:

- break the build
- corrupt data
- introduce a security vulnerability
- violate repository rules

If the request is technically feasible and does not harm system stability, it should be implemented.

---

# Testing & Verification

There is currently no guaranteed universal `npm test` script in `package.json`.

Do not assume `npm test` exists.

Validation must remain scoped to the files and behavior actually changed.

---

## Diff-aware Verification

Verification should focus on the **actual diff**.

Do not run commands unrelated to the modified code.

Examples:

- documentation change → formatting only
- comment change → no build
- small logic change → scoped lint or test
- environment config change → env validation only

However, if unsure whether a change affects type-checking or runtime behavior, **assume that it does**.

---

### Verification command order

When verification commands are required, run them in this order:

1. `npm run format`
2. `npm run lint`
3. `npm run build`

Rules:

- Stop execution if any earlier step fails.
- Do not run later steps if earlier validation fails.
- Prefer the smallest affected scope when tooling supports it.

---

### Minimum required verification by change type

#### Documentation-only changes (`*.md`, comments)

- Do not run `npm run build`
- Run formatting only for modified files if needed

---

#### Config-only changes

Examples:

- CI configuration
- example configs
- formatter or lint configuration

Rules:

- Run only checks directly affected by that configuration
- Do not run full builds unless the config affects the build pipeline

---

#### Environment variable changes

Examples:

- `.env`
- `.env.example`
- env loader code

Rules:

- Keep `.env.example` synchronized with code expectations
- Use placeholder values only
- Never commit real secrets

Run only verification relevant to env parsing or config loading.

---

#### Application code changes

For code modifications:

- format changed files
- run lint for affected scope
- run build when the change affects:
    - TypeScript types
    - imports/exports
    - runtime behavior
    - config wiring

If uncertain whether a build is needed, **run the build**.

For risky logic changes:

- add focused tests under `src/**/__tests__` when appropriate
- document how to run them

---

#### Large or cross-cutting changes

Run full verification:

```
npm run format
npm run lint
npm run build
```

Run relevant focused tests if available.

---

### Verification rules

- Prefer the smallest verification capable of detecting regressions
- Avoid unrelated test suites for narrow changes
- Avoid repository-wide formatting for small diffs

In the final report, explain:

- which verification commands were run
- why they were required or skipped

If verification could not be run, explain why.

---

# PR / Commit Expectations

Use Conventional Commits:

- `feat:`
- `fix:`
- `refactor:`
- `docs:`

Each commit should contain a single logical change.

Avoid mixing unrelated changes.

PR descriptions should include:

- behavior change summary
- migration or schema impact
- manual verification steps
- command output summary when applicable

---

# Security & Config

Secrets must remain in `.env` only:

Examples:

- API tokens
- database credentials
- storage credentials
- monitoring DSN

Never commit real secrets.

Do not log:

- raw credentials
- full connection strings

---

## Environment variable sync rules

`.env.example` is the source-of-truth template for environment variables.

If code changes:

- variable names
- defaults
- required flags
- provider-specific variables
- documented meanings

`.env.example` must be updated in the same change.

If code references a variable that does not appear in `.env.example`, the task is incomplete.

Use comments to explain complex variables when necessary.

Never include real secrets in `.env.example`.
