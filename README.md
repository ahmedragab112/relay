# Relay

A local-first coding agent workspace. Relay runs a local OpenCode engine on this Mac and gives you a calm, focused desktop shell around it: a conversation view, a tool stepper, live agent activity, a project inspector (diffs, files, browser), automations, and a command palette — all without sending your keys or code anywhere except the provider you choose.

Everything is local-first: your workspace, settings, and provider keys stay on this Mac; provider requests go through the local OpenCode engine.

## Highlights

- **Composer** — one model dropdown with inline "power" variants, plus an **Auto model** entry that rotates to the next best connected model when a request fails (rate limits, credits, invalid models). Pick **Include only free models** or maintain an explicit allow-list.
- **Chat** — markdown replies with image generation rendering (ChatGPT-style shimmer placeholder), tool stepper with "N of M steps done · K remaining", follow-up suggestion chips shown directly after the reply, per-reply **model name on hover/focus**, and **Copy chat summary** / like / branch actions.
- **Permission & question notifications** — native macOS notification when the agent needs you, with its own setting (independent of turn-completion alerts).
- **Project inspector** — Activity, Changes/diff, Files (Monaco editor), and a contextual Browser tab that appears only when needed. **Auto-follows the agent per turn** (tool log → Changes → Browser); clicking a tab stops auto-follow until the next turn.
- **Settings & Automation as full pages** — not dialogs. Settings has grouped tabs with icons: General, Appearance, Context & usage, Auto model, Voice dictation, Model providers, Archived tasks, About.
- **Theming** — Graphite (dark), Porcelain (light, macOS-native surfaces), and Follow macOS; six **accent colors** (Relay Blue, Emerald, Amber, Rose, Violet, Cyan) and three **layouts**: Tabs, Inbox, Focus.
- **Multi-language** — English and العربية (RTL). Switch in Settings → General → Language. More strings are migrated to `data-i18n` incrementally — see `src/renderer/i18n.ts`.
- **Agent control bridge** — Relay runs a localhost-only, token-protected control server and ships a CLI (`relayctl.mjs`) so agents with shell access can drive the app: `health`, `tasks`, `create-task`, `open-page`, `skills`, `install-skill`, `automations`, `create-automation`, `run-automation`. A `relay-control` skill is auto-installed so agents discover it.
- **Access level** — Read only / Ask / Auto-edit / Full access; changes apply to the running task immediately (mid-turn enforcement included).
- **Editing** — full Monaco diff review, undo/revert per file, inline "Edited N files" card with Undo/Review and a "show more" expander.

## Requirements

- macOS 13+ (packaged builds target Apple silicon; x64/Linux/Windows targets are wired in `package.json`)
- Node.js 20+ (development only)
- At least one model provider (free tiers work — see **Model providers** in settings, each with a direct "get an API key" link)

## Development

```bash
npm install
npm run dev            # start the app with the renderer dev server
npm run build          # build main + preload + renderer + stage the engine
npm start              # launch the built app

npm test               # unit tests (node:test)
npm run typecheck      # tsc --noEmit
npm run test:desktop   # build + full desktop E2E (Playwright)
```

## Packaging

```bash
npm run package:arm64  # macOS Apple silicon (release/mac-arm64)
npm run package:host   # macOS Intel
npm run package:linux  # AppImage + deb, x64 & arm64
npm run package:win    # NSIS + portable, x64
```

The app is currently **ad-hoc signed, not notarized** — first launch on another Mac needs right-click → Open, or you can sign/notarize with your own Developer ID.

## Architecture

- `src/main/` — Electron main process: engine lifecycle, IPC, settings store, workspace files, control server (`control.ts`), scheduling/automations, plugin marketplace, skill library.
- `src/preload/` — context-isolated bridge (`window.relay`).
- `src/renderer/` — the UI (no framework): chat, composer, inspector, Toolkit/Settings/Automation pages, palette.
- `src/shared/` — contracts, providers, model ranking, path helpers.
- `tests/` — unit tests plus `desktop.mjs`, a full desktop E2E against the real app.

## Relay control CLI

```bash
relayctl health
relayctl tasks
relayctl skills
relayctl automations
relayctl create-task '{"title":"Triage the flaky suite"}'
relayctl open-page '{"url":"https://example.com"}'
relayctl install-skill '{"url":"https://github.com/org/repo/tree/main/skills/foo"}'
relayctl create-automation '{"name":"Daily triage","action":{"kind":"prompt","prompt":"Summarize failures","location":"local","output":"independent","access":"ask","model":"provider::model"},"schedule":{"kind":"daily","time":"09:00"},"timezone":"UTC","enabled":true}'
```

The CLI and a per-boot token live next to the app's state (`~/Library/Application Support/relay-workspace/`). The server only binds to `127.0.0.1`.

## Notes

- Provider keys are stored encrypted on this Mac (macOS Keychain-backed where available).
- "Auto model" rotation is per-request, with an automatic mid-task switch if the model fails during a turn, and per-model limit badges in the model list (with a 6-hour TTL).
- Multi-language coverage is strongest in the app chrome; content strings migrate incrementally (`src/renderer/i18n.ts`).

## License

No license file yet — all rights reserved until one is added.
