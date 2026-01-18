# Copilot / AI coding agent instructions for Mailspring

**Short summary:** Mailspring is an Electron (TypeScript + React + Flux) client that talks to a native C++ sync engine (`mailsync`) via a newline-delimited JSON stdin/stdout protocol. There are two main codebases in this workspace: the UI client (`Mailspring/`) and the native sync engine (`Mailspring-Sync/`). This file contains the minimal, project-specific context an AI agent needs to be productive.

---

## Architecture (big picture) 🔧
- UI: `app/` — Electron app, TypeScript, React components; main process in `app/src/browser/main.js` and app entry points in `app/src/*`.
- Flux + data layer: look under `app/src/flux/` (stores, models, tasks) where application state and observable queries live. Example: `app/src/flux/stores/message-store.ts` and `app/src/flux/models/message.ts`.
- Native sync engine: `Mailspring-Sync/` — C++11 code in `MailSync/` that runs as a separate process **one per account**.
- Integration: Electron spawns `mailsync` binary (see `app/src/mailsync-process.ts`). Communication is newline-delimited JSON on stdin/stdout (mailsync emits modified objects to stdout; tasks are sent to stdin).

## Mailsync — component structure & organization 🧭
- Top-level: `Mailspring-Sync/MailSync/` contains the C++ implementation; platform project files live in `Mailsync.xcodeproj/` and `Windows/`.
- Core pieces:
  - `main.cpp` — program entry; parses CLI and `--mode` and delegates to the workers.
  - `MailProcessor.cpp / MailProcessor.hpp` — task execution, queuing, and coordination between local/remote phases.
  - `MailStore.cpp / MailStore.hpp` & `MailStoreTransaction.cpp` — sqlite-backed model storage; uses the "fat JSON" row pattern and emits modified objects to stdout.
  - `DeltaStream.cpp / DeltaStream.hpp` — formats and streams modified objects to stdout (newline-delimited JSON). Note: debug lines may be prefixed with `dbg::`.
  - `MetadataWorker.cpp`, `MetadataExpirationWorker.cpp` — handles metadata sync and streaming events from the metadata service.
  - `NetworkRequestUtils.cpp / MailUtils.cpp / DAVWorker.cpp` — network and protocol helpers for IMAP/SMTP/WebDAV operations.
  - `Query.cpp` and related helpers implement internal query logic used by the sync workers.
- Concurrency model: two primary sync threads — a foreground worker (idles on the primary folder and wakes for immediate operations) and a background worker (periodic folder syncs and resyncs). See `README.md` (Sync Approach) for high-level details.
- Task model: tasks are accepted via stdin (newline JSON) and are persisted into a tasks table (local DB change applied immediately; remote network phase may retry). Local changes are observable via stdout emissions.
- Vendor & build: `Vendor/` contains bundled dependencies (libetpan, mailcore2, etc.). `build.sh` (Linux/macOS) builds vendor libs, compiles mailsync and copies runtime artifacts into `app/`.
- Debugging & logs: mailsync returns JSON on success/error as the last newline in stdout; native failures can emit non-JSON linker errors — capture both stdout/stderr and strip secrets before publishing logs.

## Important files to inspect first 📌
- `app/src/browser/main.js` — app startup, CLI flags (`--test`, `--dev`, `--config-dir-path`).
- `app/src/mailsync-process.ts` — how the Electron app spawns & communicates with `mailsync`.
- `app/src/flux/` and `app/src/components/` — common patterns for stores, tasks and React UI components.
- `Mailspring-Sync/README.md` and `build.sh` — native build, vendor notes, platform quirks.
- `package.json` (root and `app/package.json`) — npm scripts: lint, test, build.
- `.github/workflows/*` — CI matrix and Node versions (CI uses Node 20 on Ubuntu 22.04).

## Build & dev workflows (commands you should use) ▶️
- Client (fast dev):
  - Start in dev mode: npm start (runs `electron ./app --enable-logging --dev`) from repo root.
  - Lint: npm run lint (calls `grunt lint` in the `app` Gruntfile).
  - TypeScript watch: npm run tsc-watch (useful while editing TS only).
  - Build packaged client: npm run build (uses `grunt build-client`).
- Tests: `npm test` launches `electron ./app --enable-logging --test`. There is also `npm run test-window` for windowed specs. The launcher supports `--spec-directory` and `--spec-file-pattern` flags.
- Native sync engine (Mailsync):
  - Linux/macOS: `./Mailspring-Sync/build.sh` (see README for vendor build steps: libetpan, mailcore2, OpenSSL). The script copies `mailsync` into `app/` as the runtime binary.
  - Windows: use the Visual Studio solution (see `Mailsync.xcodeproj`/Visual Studio configs). The README includes a debug command-line example for `--identity` and `--account` JSON.
  - Note: Mailsync logs and errors are often JSON; failures can be non-JSON native linker errors — keep that in mind when parsing logs.

## Project-specific patterns and conventions ⚠️
- Data model style: SQLite rows store full JSON in a `data` column plus duplicated queryable columns ("fat" JSON-first approach). Migrations are only required for new queryable columns.
- Stable IDs: message IDs are a hash of headers (rare collisions possible — be cautious when changing ID logic).
- Tasks vs remote operations: tasks sent to `mailsync` have a local action (immediate DB change) and a remote action (network). UI updates rely on the local changes being applied and emitted back as objects on stdout.
- Extension system: look at `app/src/extensions/*.ts` (composer, message-view, thread-list extensions). New UI features usually involve adding an extension and a registration file.
- Mixed JS/TS codebase: some older modules are JS (e.g., `app/src/browser/main.js`) — check runtime vs build-time when modifying.
- When adding C++ source files to `Mailspring-Sync`, remember: platform project files (Xcode/VS/CMake) may need manual updates — there is no full auto-sync for all targets.

## Debugging tips 🐞
- Electron main flags: `--dev`, `--test`, `--spec-directory`, `--spec-file-pattern` (see `main.js` for parsing and behaviour).
- To reproduce `mailsync` behavior quickly, run the binary standalone with the `--mode` argument and provide `--identity` and `--account` JSON (the README supplies an example long `--identity` string for debugging).
- For Linux mailcore/libetpan issues: `Mailspring-Sync/build.sh` builds `libetpan` and `mailcore2` locally; many problems stem from mismatched vendor libraries.
- When investigating inter-process issues, capture stdout/stderr; `mailsync` sometimes emits debug lines prefixed with `dbg::` and final JSON payloads — strip secrets and parse the last JSON line.

## CI & release cues 🔁
- CI uses Node 20 (Ubuntu 22.04): see `.github/workflows/*` for exact commands (lint, build, package and snapshot uploads).
- Packaging details and platform-specific signing are handled in `app/build/*` and CI steps (look at `app/build/Gruntfile.js` and `.github/workflows/*`).

## What NOT to suggest as a rule-of-thumb ❗
- Don’t assume adding a C++ file automatically wires it into macOS Xcode/Windows VS projects — verify and add to project defs manually.
- Don’t change `mailsync` stdout protocol (newline-delimited JSON) without coordinating both the native and Electron sides — GUI relies on exact behaviour.

---

If you'd like, I can:
- Merge this into `.github/copilot-instructions.md` (create/replace) — ready to commit.
- Add a brief `AGENT.md` that includes the same content plus a small checklist for PR review and testing steps.

Please tell me if you want any of the following added or expanded: more examples for adding a Flux store, a sample `mailsync` debug session, or platform-specific build caveats for Windows. 🔁
