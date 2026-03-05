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
- Guided semi-automatic `openclaw onboard --install-daemon`.
- Schema-driven model config prompts from backend response.
- Merge write to `~/.openclaw/openclaw.json`.
- Browser isolated profile config when Chrome exists.
- Gateway start and connectivity verification with Bearer token.
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
