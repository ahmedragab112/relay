# Round: Agent browser in Relay (no Chrome) + quit fix

## Goal
The agent in Relay can't use the browser: the engine's `opencode.browser` plugin only exposes
browser tools once a **desktop host attaches** (`attach version 4` protocol). OpenCode's own
desktop app is that host. Relay must become the host itself, backed by Relay's own Electron
(Chromium) — the agent browses directly inside Relay, zero Chrome dependency.

## Verified protocol (spike: tests/browser-spike.mts → SPIKE_OK)
- `client.rpc(Browser.Definition)` from `@opencode/plugin-browser@2.2.6` (matches staged engine 2.2.6)
- Desktop → server: `attach({sessionID, connectionID, version:4})` (stays pending), `state({…, state})`
  (resolves = ack), `result({…, requestID, outcome})`, `command({…, requestID})` → `{action}`
- Server → desktop: control events `attached` / `command` / `cancel` on `rpc.experimental.browser.control`
- Every RPC needs `location: {directory: <workspace>}` or the engine rejects with
  "Session belongs to another location."
- 45 operations; outputs validated server-side via `Operations[].output` codecs (schema is the oracle).

## Scope this round
1. **Quit fix** (root-caused): `before-quit` cleared the 6s force-quit backstop before `app.quit()`;
   window close handler blocks quit to ask the renderer, which cannot answer while still loading →
   permanent hang (observed: packaged app hung >4min; renderer-loaded quit works in 1s).
   Fix: keep backstop armed for the whole quit; allow close while `webContents.isLoading()`.
2. **Browser host v1** — `src/main/browser.ts` (host+registry) + `src/main/browser-page.ts` (Electron driver):
   - Attach per Relay session on create; publish tab state; answer commands; cancel support.
   - Tabs: main-process WebContentsViews, in-memory partition per attachment; `tabs.focus` shows a real
     window (screenshots need a visible tab).
   - Actions v1: tabs.list/open/close/focus, navigate/back/forward/reload/stop, snapshot (a11y tree + refs),
     find, evaluate, click/hover/fill/fill_form/select/check, press, scroll, dialog, wait, console,
     network.list/get, screenshot.
   - Clear `unsupported` failures: files.*, cpu/trace/heap/lighthouse, tunnel.*, preview, drag.
3. **Tests**: unit (host machine vs fake rpc/driver, pure snapshot+refs, tab registry), integration
   (real engine handshake), E2E (scripted test-model calls browser tools; quit verification).

## Out of scope (later rounds)
Embedded-pane hosting of agent tabs inside Relay's browser page, files upload/drop, trace/heap/lighthouse,
tunnel proxying, per-tab UI polish.
