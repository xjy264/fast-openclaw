# fast-openclaw

`fast-openclaw` now includes two executables:

- `fast-openclaw`: macOS one-click setup CLI for end users.
- `fast-openclaw-server`: backend + admin page for license/key management.

## Quick Start

### 1) Start backend and admin page

```bash
npm install
npm run build
FAST_OPENCLAW_ADMIN_TOKEN="change-this-token" npm run start:server
```

Default server address: `http://localhost:8787`

Admin page: `http://localhost:8787/admin`

### 2) Create a license key in admin page

- Open `/admin`
- Save admin token
- Create key
- Copy key to customer

### 3) Customer runs CLI

```bash
FAST_OPENCLAW_API_BASE="http://localhost:8787" npx @your-scope/fast-openclaw
```

The CLI asks for one-time key first. Key must validate before install/config starts.

## CLI Features

- One-time license gating before setup actions.
- Resume flow with `--resume <token>` within backend time window.
- OpenClaw install + version check + PATH auto-recovery (`zsh` and `bash`).
- Strict non-interactive onboarding (`--accept-risk`, `--mode local`, `skip model/skills/channels/ui/health`) with daemon install and no interactive fallback.
- Model preset selection from five options (OpenAI/Claude/Gemini/GLM/Kimi).
- Merge write to `~/.openclaw/openclaw.json`.
- Model connectivity test immediately after model config write.
- Browser isolated profile config when Chrome exists.
- Gateway start and connectivity verification without prompt (server defaults/env/local config token).
- Telegram bind after gateway: token validate -> auto discover chat id -> send test message.
- Telegram weak validation: user sends `你是谁` and `/model`, CLI verifies inbound events are received.
- Channel scope in v1: Telegram only.
- Standalone stage diagnostics with `--test-only` (`model|gateway|telegram|all`).
- Interactive doctor mode with `--doctor` to click/select checks and get troubleshooting hints.
- Session complete callback burns the one-time key.

## Server Features

- One-time license lifecycle: `NEW -> IN_USE -> USED`.
- Device fingerprint binding on first successful `start`.
- 24h resumable token window by default.
- Admin actions: create/list/disable/reset licenses.
- Built-in model schema (ChatGPT/Gemini/GLM/Claude/Kimi presets).

## Commands

```bash
# CLI
npm run dev -- --help

# Server (dev)
npm run dev:server

# Server (prod)
npm run build
npm run start:server
```

## CLI Options

```bash
fast-openclaw --api-base <url> --resume <token> --debug
```

Additional option:

- `--skip-openclaw-reset`: skip `openclaw reset --scope full` (default behavior is full reset to avoid reusing any historical config/channel state).
- `--telegram-bot-token <token>`: provide Telegram bot token non-interactively.
- `--telegram-chat-id <id>`: force chat id, skip auto discovery.
- `--skip-telegram-bind`: debug only, skip Telegram bind step.
- `--test-only <model|gateway|telegram|all>`: run isolated diagnostics without license/backend flow.
- `--doctor`: interactive diagnostics menu; users can select model/gateway/telegram/full checks and see likely fixes.

Onboarding behavior in v1:
- CLI does not fall back to interactive onboarding.
- If non-interactive onboard fails, setup exits with `ONBOARD_FAILED` and includes command output summary.

Doctor mode usage:

```bash
FAST_OPENCLAW_API_BASE="http://localhost:8787" npx @your-scope/fast-openclaw --doctor
```

## Setup Stage Order

Full setup flow is now:

1. `configured`: write model/browser config.
2. `model_verified`: model API connectivity test.
3. `gateway_verified`: gateway connectivity + `openclaw agent` strict gateway check.
4. `telegram_bound`: Telegram bind + test message send.
5. `completed`: backend `complete` burns one-time key.

End-user required inputs in default mode:
1. one-time license key
2. model choice + model API key (for example GLM key)
3. Telegram bot token (chat id can auto-discover)

## Environment Variables

### CLI

- `FAST_OPENCLAW_API_BASE`: setup backend base URL.

### Server

- `PORT` (default `8787`)
- `HOST` (default `0.0.0.0`)
- `FAST_OPENCLAW_ADMIN_TOKEN` (default `change-me`, change this in production)
- `FAST_OPENCLAW_RESUME_HOURS` (default `24`)
- `FAST_OPENCLAW_GATEWAY_URL` (optional, default gateway URL for CLI)
- `FAST_OPENCLAW_GATEWAY_TOKEN` (optional, default gateway token for CLI)
- `FAST_OPENCLAW_MODEL_PROVIDER` (optional, reorder default option in selector)
- `FAST_OPENCLAW_MODEL_API_KEY` (optional global fallback for model api key prompt)
- `FAST_OPENCLAW_MODEL_<PROVIDER>_API_KEY` (optional per-provider key default, e.g. `FAST_OPENCLAW_MODEL_GLM_API_KEY`)
- `FAST_OPENCLAW_MODEL_<PROVIDER>_BASE_URL` (optional per-provider baseUrl override)
- `FAST_OPENCLAW_MODEL_<PROVIDER>_MODEL_ID` (optional per-provider model id override)
- `FAST_OPENCLAW_MODEL_<PROVIDER>_MODEL_NAME` (optional per-provider model name override)
- `FAST_OPENCLAW_DATA_FILE` (default `./.data/store.json`)

## API Endpoints

### Setup API (used by CLI)

- `POST /v1/setup/session/start`
- `POST /v1/setup/session/resume`
- `POST /v1/setup/session/events`
- `POST /v1/setup/session/complete`

### Admin API (requires `Authorization: Bearer <admin-token>`)

- `GET /admin/api/licenses`
- `POST /admin/api/licenses`
- `POST /admin/api/licenses/:id/disable`
- `POST /admin/api/licenses/:id/reset`

## Files

- CLI resume state: `~/.openclaw/setup-state.json`
- OpenClaw config: `~/.openclaw/openclaw.json`
- Server data store: `./.data/store.json` (or `FAST_OPENCLAW_DATA_FILE`)

## Development

```bash
npm run test
npm run typecheck
npm run build
```
