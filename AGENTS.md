# Repository Guidelines

## Response Workflow

- Before answering implementation/design/bug questions, inspect the relevant source files first, then respond.
- Do not answer based on assumptions when code can be checked in-repo.
- If context is unclear, locate related modules with search (`rg`) and verify current behavior before proposing changes.
- Always start work by creating and updating a plan with `functions.update_plan`.
- For code edits, use `functions.apply_patch` whenever possible.

## Project Structure

- `src/index.ts`: bot bootstrap, command/event loading, slash interaction entrypoint.
- `src/command_slash/`: slash command modules (`export const command`).
- `src/command_legacy/`: legacy text command modules (`logger <command>`).
- `src/commandShared/`: shared command logic used by both slash/legacy commands. Prefer adding common logic here to avoid duplication.
- `src/events/`: Discord event handlers (`export default { name, once?, execute }`).
- `src/db/`: PostgreSQL access, migration/runtime queries.
- `src/storage/`: attachment storage abstraction and providers (`local`, `webdav`, `s3`, `smb`).
- `src/config/`: environment parsing and runtime config.
- `scripts/`: DB setup/migration scripts.
- `dist/`: build output only. Do not edit manually or commit generated diffs unless explicitly required.

## Runtime Architecture Notes

- This project is ESM (`"type": "module"`) + TypeScript `NodeNext`.
- In TypeScript source, local imports must use `.js` extension in path strings.
- Slash/legacy/events are dynamically loaded from compiled `.js` files.
- `InteractionCreate` is handled directly in `src/index.ts` (not dynamically loaded from `src/events`).
- Legacy commands are executed in `messageCreate` when prefix is `logger ` and dev level is sufficient.
- Slash commands are registered globally via REST on load; Discord global propagation can take time.

## Commands (package.json)

- `npm run dev`: run with `tsx` (`src/index.ts`).
- `npm run build`: compile TypeScript (`tsc`).
- `npm run type`: type-check only (`tsc --noEmit`).
- `npm start`: run compiled bot (`dist/index.js`).
- `npm run lint`: ESLint.
- `npm run format`: Prettier write.
- `npm run db:setup`: initial DB generation script.
- `npm run db:migrate`: DB migration script.
- `npm run db:migrate:storage-path`: attachment storage path migration.
- `npm run clean`: removes `dist`, `node_modules`, and `package-lock.json` then reinstalls (destructive; use carefully).

## Coding Style & Naming

- TypeScript strict mode is enabled; keep types explicit and safe.
- Follow the repository Prettier config in `.prettierrc` (4-space indentation, single quotes, semicolons, trailing commas, `printWidth: 100`, `endOfLine: lf`).
- Avoid `any` (ESLint error). Prefer narrowing/type guards.
- `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` are disallowed by lint rules.
- Keep file naming consistent with each directory's current pattern:
- `src/command_slash/`, `src/command_legacy/`: primarily `snake_case` (some slash commands also use hyphenated names such as `report-guild.ts`).
- `src/events/`: `camelCase` event filenames (for example `messageCreate.ts`, `voiceStateUpdate.ts`).
- `src/utils/`, `src/services/`, `src/config/`, `src/queue/`, `src/commandShared/`: mostly `camelCase`.
- `src/storage/providers/`: `PascalCase` provider class filenames.
- `src/types/`: mostly `camelCase` with occasional kebab-case `.d.ts` files; match existing local convention.
- Do not mass-rename files only for style consistency.

## Module Contracts (Important)

- Slash command module contract: `export const command = { data, execute }`.
- Legacy command module contract: `export { command }` with `{ name, execute }`.
- Event module contract: default export `{ name, once?, execute }`.
- Breaking these shapes will make dynamic loaders skip modules at runtime.

## Testing & Verification

- There is currently no stable `npm test` script in `package.json`.
- Required verification for changes: always run `npm run build`, `npm run lint`, and `npm run format`.
- For risky logic changes, add focused tests under `src/**/__tests__` and document how to run them.

## PR / Commit Expectations

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`).
- Keep commits scoped to one logical change.
- PR description should include behavior change summary, DB/schema or migration impact, and manual verification steps with command output summary.

## Security & Config

- Secrets must stay in `.env` only (tokens, DB creds, storage creds, Sentry DSN).
- Do not log raw credentials or full connection strings.
- Storage backend is selected by `STORAGE_TYPE`; ensure required env vars exist per provider before deployment.
