# Repository Guidelines

This file is the operating contract for agents working in this repository.

Primary goals:

1. solve the requested task correctly
2. inspect real repository state before implementation claims
3. keep changes minimal and directly related
4. verify only what the diff requires
5. reduce token waste without losing technical accuracy

Token economy matters. Be concise, but never ambiguous where precision affects safety, correctness, or maintainability.

---

# Communication Mode

## Default Style

Use compact technical communication.

Prefer:

- short sentences
- direct claims
- concrete file paths, symbols, commands, and outcomes
- bullets only when they improve scanability
- one explanation per issue
- exact error strings when relevant

Avoid:

- filler: "sure", "certainly", "of course", "happy to", "basically", "actually", "simply"
- hedging when evidence exists: "maybe", "probably", "it seems", "I think"
- restating the user's request
- motivational or decorative text
- long preambles
- repeating the same rule in different words

Good:

> `src/auth/session.ts`: expiry comparison uses `<`, so expired-at-now token remains valid. Change to `<=` and add boundary test.

Bad:

> I took a look at your authentication flow and it appears that there may be an issue with how token expiration is being handled. I would recommend considering a change to the comparison operator.

## Compression Levels

Use the shortest level that preserves correctness.

| Level     | Use when                                                | Style                                 |
| --------- | ------------------------------------------------------- | ------------------------------------- |
| `clear`   | default for normal task work                            | concise full sentences, no filler     |
| `compact` | status updates, routine findings, small diffs           | fragments allowed, arrows allowed     |
| `full`    | architecture, security, migrations, destructive changes | complete reasoning, explicit ordering |

Do not use extreme compression when it can change meaning.

Examples:

- `clear`: "Inline object prop creates a new reference each render. Wrap it in useMemo."
- `compact`: "Inline object prop → new ref each render → rerender. Use useMemo."
- `full`: "This migration drops a column. Confirm backup and deployment order before applying because rollback cannot recover deleted column data."

## Auto-Clarity Rule

Use fuller wording when compression creates risk.

Expand communication for:

- destructive commands
- security issues
- data migrations
- authentication/authorization changes
- payment, billing, or permission logic
- production incidents
- multi-step sequences where order matters
- ambiguous user instructions
- conflicting evidence
- verification failures
- final reports that need auditability

After the risky part is clear, return to compact style.

## Preserve Exactly

Never rewrite or compress these unless the task explicitly asks to modify them:

- code blocks
- inline code
- commands
- file paths
- URLs
- environment variable names
- API names
- package names
- version numbers
- database table/column names
- error messages
- stack traces
- logs used as evidence
- user-provided identifiers

## Status Updates

For long work, give short updates only when useful.

A status update should include one of:

- what was inspected
- what was found
- what changed in the plan
- what verification is running or skipped and why

Avoid progress theater.

Good:

> Inspected auth middleware + session tests. Root cause is expiry boundary, not refresh flow.

Bad:

> I am continuing to look through the repository and will now proceed to inspect additional files.

---

# Response Workflow

Before answering implementation, design, or bug questions:

1. Inspect relevant source files first.
2. Search related modules with `rg` when exact files are unknown.
3. Read call sites before changing shared functions.
4. Check tests and scripts before assuming how verification works.
5. Do not answer from memory when repository state can be checked.

If code can be inspected, inspect it.

If context is unclear:

- locate relevant modules with `rg`
- inspect imports, exports, route registration, config wiring, and tests
- state uncertainty only after checking available evidence

Do not invent repository behavior.

---

# Token Economy Rules

## Core Rule

Save tokens by removing noise, not by removing reasoning.

Keep:

- root cause
- change scope
- risks
- verification
- exact commands
- exact files
- user-visible behavior

Drop:

- pleasantries
- repeated summaries
- obvious narration
- generic disclaimers
- duplicated explanations
- broad tutorials unless requested

## Compact Working Notes

Plans and investigation notes should be dense.

Do not spend tokens narrating plans in chat when a structured planning mechanism is available.

Use the environment's plan/state mechanism as the primary working memory for non-trivial tasks. Examples across agents include a plan tool, task ledger, todo state, workflow state API, checklist state, or equivalent.

Only print a Markdown plan when no structured mechanism exists. If using Markdown fallback, keep it compact:

```md
Plan:

- Inspect: `src/auth/**`, `middleware.ts`, session tests.
- Hypothesis: expiry boundary accepts token at exact expiry.
- Change: comparison + boundary test only.
- Verify: format touched files; run auth test; build if types/imports change.
- Revise if: refresh flow owns expiry or tests show related breakage.
```

Do not use generic plan steps such as:

- inspect code
- fix bug
- run tests

## Output Budget

Default final report target:

- summary: 1-3 bullets
- changed files: only important files
- verification: commands run or skipped with reason
- caveats: only if real

Do not include full diffs unless requested.

Do not paste large unchanged files.

## Avoid Duplicate Context

If the same fact appears in a plan, update, and final report, compress later mentions.

Example:

- Update: "Root cause: `token.exp < now` accepts exact-expiry tokens."
- Final: "Fixed expiry boundary in `src/auth/session.ts`; added exact-expiry test."

No need to re-explain the whole mechanism again.

## Use Evidence Labels

When reporting findings, label the certainty source compactly:

- `inspected`: confirmed in code
- `tested`: confirmed by command
- `inferred`: supported but not directly executed
- `blocked`: could not verify; explain why

Example:

> inspected: `src/api/users.ts` still exports `getUserProfile`; no import migration needed.

---

# Planning Requirement

Always start non-trivial work by creating and maintaining a detailed plan.

The plan acts as working memory for the session. Keep it updated when evidence changes.

For non-trivial tasks, a plain chat block is not enough when the environment provides structured planning. Use the available plan/state mechanism so progress is externally visible and enforceable.

A valid plan must include:

- task classification
- investigation targets: files, modules, commands, or components to inspect
- current behavior and root-cause hypothesis
- intended change scope
- directly connected files that may require modification
- exact verification steps
- conditions that require revising the plan

Plans are provisional notes, not constraints.

Revise the plan immediately when inspection or verification disproves earlier assumptions.

Do not begin editing until the plan is specific enough to execute without guesswork.

## Structured Plan State

Use a structured plan mechanism when available. This means any agent-native tool or state channel that tracks steps and statuses outside ordinary prose.

Required behavior:

- create the plan before the first edit for every non-trivial task
- keep exactly one active step when the mechanism supports statuses
- mark completed steps promptly
- update the active step before switching phases
- revise planned steps when inspection changes the hypothesis or scope
- mark blocked steps with the concrete blocker and next possible action
- do not leave stale `pending` or `in_progress` steps after final verification

Recommended statuses, or nearest equivalent:

- `pending`: known work not started
- `in_progress`: current active work
- `completed`: finished and no longer active
- `blocked`: cannot proceed without missing permission, dependency, or user input

Use Markdown plans only as fallback when no structured plan mechanism exists. When falling back, say so once and keep the plan compact.

## Plan Content

Each step should be executable without guessing. Use concrete targets and outcomes:

```md
- Classify task and inspect `package.json`, `src/auth/session.ts`, and auth tests.
- Trace `validateSession` call sites with `rg "validateSession"`.
- Patch expiry comparison and add exact-boundary test.
- Run formatter for touched files, then focused auth test, then build only if types/imports changed.
```

## Invalid Plans

Invalid:

- inspect code
- apply fix
- run checks
- update docs
- improve tests

Valid:

- inspect `src/lib/env.ts` and `src/lib/env.test.ts` for missing `DATABASE_URL` validation
- update `.env.example` only if code introduces or renames env variables
- run `npm run format -- src/lib/env.ts src/lib/env.test.ts` if script supports file args; otherwise run documented formatter path

---

# Task Classification

Before changes, classify the task:

- `docs-only`: Markdown, comments, prose docs. Generated docs only when they are the repository source of truth.
- `config-only`: CI, formatter, lint, example config, package config
- `env-only`: `.env.example`, env loader, env docs
- `code`: application/runtime/test code
- `cross-cutting`: touches multiple layers or behavior areas

Verification must match the classification.

Avoid unrelated commands.

If unsure whether a change affects runtime, treat it as code.

---

# Scope & Change Control

## Scope Detection

Before code changes, determine the minimal required scope:

- single function
- single file
- module
- cross-module

Prefer the smallest scope that fully solves the task.

Expand only when direct evidence requires it:

- compile errors
- type errors
- import/export failures
- failing focused tests
- broken runtime integration
- directly connected config/env mismatch

Do not modify unrelated files.

## Patch Minimalism

Every changed line must have a direct relationship to the request.

Avoid:

- unrelated refactors
- unrelated renames
- reformatting untouched code
- architecture rewrites
- speculative abstractions
- style churn
- dependency changes without need
- broad cleanup while fixing a narrow bug

Allowed:

- formatting touched files
- fixing directly connected breakage revealed by verification
- updating docs/env examples required by the code change
- adding focused tests for risky behavior

## Protected Configuration Files

These files are locked configuration:

- `eslint.config.js`
- `tsconfig.json`

Do not intentionally modify, rewrite, regenerate, or normalize them unless explicitly instructed.

Exception: if a legitimate formatting command causes incidental formatting-only changes to locked files, that is acceptable only when:

- the command was required for touched files
- changes are formatting-only
- the exception is not used to smuggle unrelated edits
- repository-wide formatting was not run gratuitously

## Directly Connected Files

A file is directly connected when the requested change cannot be correct without it.

Examples:

- code reads new env variable → `.env.example` is connected
- exported function signature changes → call sites and tests are connected
- route behavior changes → route tests and API docs may be connected
- migration changes schema → model/types/query code may be connected

Not connected:

- nearby style issues
- old TODOs
- unrelated test failures
- unrelated lint warnings outside affected scope

---

# Defensive Code Policy

Avoid speculative defensive programming.

Do not add layered guards, broad try/catch, or silent fallback behavior unless tied to a known failure mode.

Acceptable safeguards:

- one direct guard for external input
- explicit validation for API/env/config data
- error check matching project patterns
- boundary handling proven by bug or test

Bad:

```ts
try {
    if (x) {
        if (x.value) {
            // speculative nested guard maze
        }
    }
} catch {}
```

Good:

```ts
if (!session) return unauthorized();
```

Do not swallow errors unless the repository already treats that path as best-effort and the reason is documented.

---

# Request Handling

Implement technically feasible requests unless the change would clearly:

- break the build
- corrupt data
- introduce a security vulnerability
- violate repository rules
- perform an irreversible action without explicit confirmation

If a request conflicts with repository rules, explain the conflict and apply the closest safe alternative.

Do not refuse because the task is large.

When the task is too broad for one safe patch:

1. perform the minimal coherent slice
2. document remaining work
3. avoid pretending the whole task is complete

---

# SubAgents Usage

Use SubAgents only when they provide clear leverage.

If SubAgents are unavailable, perform the same bounded investigation directly.

Use them for:

- parallelizable investigation
- comparing multiple modules
- independent root-cause checks
- large impact assessment
- specialized verification review
- separate security or migration review

Do not use them for:

- narrow single-file fixes
- work where delegation overhead exceeds benefit
- tasks needing tightly shared context
- mechanical compliance

When using SubAgents:

- assign bounded objectives
- avoid overlapping scopes
- require file paths and evidence
- consolidate findings into the main plan
- treat output as input, not truth
- verify important claims in the main context before editing

SubAgent prompt should be compact:

```md
Inspect `src/billing/**` for invoice total calculation. Goal: find where tax applied twice. Return files, symbols, evidence, no fix.
```

---

# Repository Inspection

## Search First When Unknown

Use `rg` to locate:

- symbols
- route names
- env variables
- feature flags
- error strings
- test names
- config keys

Examples:

```sh
rg "getUserProfile"
rg "DATABASE_URL|POSTGRES"
rg "InvoiceTotal"
```

## Read Before Edit

Before editing a file, inspect enough surrounding context to understand:

- imports/exports
- local patterns
- error handling style
- tests or absence of tests
- public API implications
- data ownership

Do not patch isolated lines without understanding their call path.

## Prefer Existing Patterns

Follow repository patterns for:

- naming
- validation
- logging
- errors
- dependency injection
- tests
- folder layout
- commit scopes

Do not introduce a new pattern unless required by the task.

---

# Testing & Verification

There is no guaranteed universal `npm test` script in `package.json`.

Do not assume `npm test` exists.

Inspect `package.json` before using scripts.

Validation must be scoped to the actual diff.

## Diff-aware Verification

Verification should focus on changed behavior.

Examples:

- documentation change → formatting only if needed
- comment change → no build
- small logic change → format touched files, focused lint/test
- env loader change → env parsing test + `.env.example` sync
- import/export or TypeScript type change → build
- cross-cutting change → full verification

If unsure whether a code change affects type-checking or runtime behavior, run build.

## Verification Command Order

When verification commands are required, run in this order:

1. `npm run format`
2. `npm run lint`
3. `npm run build`

Rules:

- stop if an earlier required step fails
- do not run later steps after earlier failure unless fixing the failure requires more inspection
- prefer smallest affected scope when tooling supports it
- do not invent script names
- if a script is absent, say it is absent and use the closest available scoped command

## Minimum Required Verification by Change Type

### Documentation-only Changes

For `*.md`, comments, docs prose:

- do not run `npm run build`
- run formatting only if repository formatter applies to the modified file
- skip verification if no project files/scripts are available and the Markdown is manually reviewed

Final report must say why build/lint were skipped.

### Config-only Changes

Examples:

- CI configuration
- formatter configuration
- lint configuration
- example config
- package scripts

Run only checks directly affected by that config.

Do not run full build unless the config affects build pipeline.

### Environment Variable Changes

Examples:

- `.env.example`
- env docs
- env loader code
- deployment config templates

Rules:

- keep `.env.example` synchronized with code expectations
- use placeholder values only
- never commit real secrets
- run env parsing/config loading tests if available
- run build when env types/imports change

### Application Code Changes

For runtime code:

- format changed files
- run lint for affected scope
- run focused tests when available
- run build when change affects TypeScript types, imports/exports, runtime behavior, or config wiring

For risky logic:

- add focused tests when appropriate
- place tests under existing test convention, commonly `src/**/__tests__`
- document exact test command

### Large or Cross-cutting Changes

Run full verification:

```sh
npm run format
npm run lint
npm run build
```

Run relevant focused tests if available.

### Verification Failure

If verification fails:

1. stop later verification steps
2. inspect failure
3. determine whether it is caused by the diff
4. fix directly connected breakage only
5. rerun the failed command
6. report unrelated pre-existing failures separately

Do not hide failures.

Do not claim success when commands failed or were not run.

## Final Verification Report

Final report format:

```md
Summary:

- changed X to fix Y
- added/updated Z

Verification:

- `npm run format` — passed
- `npm run lint` — skipped; docs-only change
- `npm run build` — skipped; docs-only change

Notes:

- any real caveat, or omit section
```

Keep it short.

---

# Code Change Rules

## Implementation Discipline

Before changing code:

- know the owner module
- know call sites for changed symbols
- know expected behavior
- know verification path

During changes:

- make the smallest complete patch
- use existing abstractions
- preserve public behavior not mentioned by the task
- keep error messages stable unless the task requires changing them
- avoid opportunistic cleanup

After changes:

- inspect diff
- verify scoped behavior
- report only relevant files and commands

## Tests

Add or update tests when:

- fixing a bug with clear expected behavior
- changing branching logic
- changing parsing/validation
- changing security-sensitive behavior
- changing public API behavior
- preventing regression is cheap and focused

Do not add broad tests unrelated to the changed behavior.

If no test framework exists, say so and use available verification.

## Error Handling

Errors should be:

- explicit
- actionable
- consistent with project style
- not overly verbose
- not leaking secrets

Never log:

- raw credentials
- API tokens
- full connection strings
- session cookies
- private keys
- customer secrets

---

# Documentation Rules

Docs should be accurate, compact, and task-scoped.

When editing docs:

- keep headings meaningful
- avoid marketing language
- avoid repeating the same rule in multiple sections
- preserve code blocks exactly unless changing them is the task
- ensure commands are copy-pasteable
- mark placeholders clearly
- keep examples minimal but complete

For generated docs, include only information verified from repository state or explicitly provided by the user.

---

# Security & Config

Secrets must remain in `.env` only.

Examples:

- API tokens
- database credentials
- storage credentials
- monitoring DSN
- private keys
- session secrets

Never commit real secrets.

Never place real secrets in:

- `.env.example`
- README
- tests
- logs
- fixtures
- screenshots
- comments

## Environment Variable Sync Rules

`.env.example` is the source-of-truth template for environment variables.

If code changes any of these, update `.env.example` in the same change:

- variable name
- default
- required/optional status
- provider-specific variable
- documented meaning
- expected format

If code references a variable absent from `.env.example`, the task is incomplete.

Use comments for complex variables only.

Use placeholder values only.

## Config Safety

For config changes:

- understand load order
- check env overrides
- avoid breaking local development
- preserve default behavior unless requested
- document migration impact if behavior changes

---

# Database & Migration Rules

For schema or data changes:

- inspect models, queries, migrations, and seed/test data
- identify rollback path
- check production safety
- avoid destructive operations without explicit confirmation
- update types and env/docs if required

Destructive migration communication must be full clarity, not compressed.

Before destructive SQL, state:

- what data is affected
- whether it is reversible
- backup requirement
- deployment order
- verification query

Never compress command order when data loss is possible.

---

# Frontend Rules

When changing UI:

- inspect component hierarchy and shared UI primitives
- preserve existing design system patterns
- avoid unrelated restyling
- check loading, empty, error, and permission states when touched
- keep accessibility attributes when existing patterns use them

For React/Next.js:

- avoid unnecessary client components
- avoid unstable inline objects/functions in hot render paths when they cause rerenders
- keep server/client boundary explicit
- update types when props change
- verify route/page build when imports or module boundaries change

---

# Backend Rules

When changing backend logic:

- inspect route registration
- inspect middleware order
- inspect request validation
- inspect auth/session ownership
- inspect database query behavior
- avoid changing API shape unless requested

For Go/Gin:

- follow existing handler/service/repository split
- return consistent status codes and error envelopes
- avoid swallowing errors
- validate external input at boundary
- keep context propagation intact

For TypeScript backend:

- keep schema validation close to input boundary
- avoid `any` unless project already uses it in that path and no better type is practical
- preserve public types unless migration is intended

---

# Dependency Rules

Do not add dependencies unless necessary.

Before adding a dependency:

- check existing packages
- evaluate whether platform/library already provides feature
- consider bundle/runtime impact
- update lockfile through package manager only
- verify license/security suitability when relevant

Do not manually edit lockfiles.

Do not switch package managers.

---

# Build, Scripts, and Tooling

Before running scripts:

- inspect `package.json`
- use existing scripts
- prefer scoped commands if supported
- do not assume `npm test`

Command reporting should be exact:

```md
- `npm run lint` — failed: pre-existing `no-explicit-any` in `src/legacy/foo.ts`
```

Do not summarize failed commands as "checks passed".

---

# Git, Commit, and PR Expectations

Use Conventional Commits:

- `feat:`
- `fix:`
- `refactor:`
- `docs:`
- `test:`
- `chore:`
- `build:`
- `ci:`

Each commit should contain one logical change.

Avoid mixing unrelated changes.

Commit and push only when explicitly requested or required by repository workflow.

When committing, use one logical commit per task.

## Commit Message Style

Use compact Conventional Commit messages.

Subject:

- imperative mood: `fix`, `add`, `remove`, `update`
- no trailing period
- ideally ≤50 chars, hard cap 72
- scope optional but useful

Body only when needed:

- non-obvious why
- breaking changes
- migrations
- security fixes
- revert context
- linked issues

Avoid:

- "This commit..."
- "I/we..."
- AI attribution
- restating file names when scope explains it
- filler

Examples:

```txt
fix(auth): reject tokens at exact expiry
```

```txt
feat(api)!: rename /v1/orders to /v1/checkout

BREAKING CHANGE: clients must migrate before 2026-06-01.
Old route returns 410 after removal window.
```

## PR Description

PR descriptions should include:

- behavior change summary
- migration/schema impact
- verification commands and results
- manual verification steps when relevant
- known caveats

Keep concise.

---

# Code Review Output

When reviewing diffs, write comments as actionable one-liners when safe.

Preferred format:

```md
`file.ts:L42`: bug: `user` can be null after lookup. Return 404 before reading `.email`.
```

Severity prefixes:

- `bug:` broken behavior
- `risk:` fragile or likely incident path
- `security:` exploitable or sensitive issue
- `nit:` style or micro-optimization
- `q:` genuine question

Drop:

- "I noticed..."
- "It seems..."
- "You might want to consider..."
- per-comment praise
- restating the diff
- hedging when evidence is clear

Keep:

- exact file and line
- exact symbol names
- concrete fix
- why, when not obvious

Use fuller paragraphs for:

- security findings
- architectural disagreements
- migrations
- onboarding explanations
- issues where terse wording may sound misleading

---

# Final Answer Rules

Final answers must be accurate, compact, and auditable.

Include:

- what changed
- important files changed
- verification run/skipped
- unresolved caveats, if any

Avoid:

- long narrative of every step
- unrelated recommendations
- duplicate summaries
- claiming verification that was not run
- saying something is impossible without evidence

Use this default shape:

```md
Summary:

- ...

Verification:

- `command` — result or skipped reason
```

Add `Notes:` only for real caveats.

---

# Caveman-inspired Compression for Repository Memory

This repository allows compact memory/rule-file style, inspired by Caveman token-saving principles.

When compressing repository instructions or memory files:

- preserve technical substance
- preserve Markdown structure
- preserve headings unless changing structure is requested
- preserve code blocks exactly
- preserve inline code exactly
- preserve commands exactly
- preserve paths and URLs exactly
- preserve numbers, versions, dates, and names exactly
- remove filler and redundant wording
- merge duplicate bullets
- keep one representative example when multiple examples say the same thing

Allowed transformations:

- "in order to" → "to"
- "make sure to run" → "run"
- "it is important that" → direct rule
- "you should consider" → direct action or remove if speculative
- "utilize" → "use"
- "implement a solution for" → "fix"

Do not compress:

- source code files
- JSON/YAML/TOML config
- lockfiles
- env files
- SQL migrations
- shell scripts
- generated files

If a file mixes prose and code, compress only prose outside code blocks.

---

# Conflict Resolution

When rules conflict, priority order:

1. safety/security/data integrity
2. explicit user request
3. repository correctness
4. minimal diff
5. scoped verification
6. token economy

Token economy never overrides correctness.

Minimal diff never overrides required verification.

User request never overrides security or data integrity.

---

# Quick Reference

## Before Edit

- classify task
- inspect relevant files
- search call sites
- write concrete plan
- choose minimal scope

## During Edit

- change only related lines
- follow existing patterns
- avoid speculative guards
- keep config/env/docs synced

## After Edit

- inspect diff
- run scoped verification in order
- stop on failure
- fix only connected breakage
- final report: summary + verification + caveats

## Communication

- concise by default
- exact where technical
- full clarity for risky operations
- no filler
- no fake certainty
