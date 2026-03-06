#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[setup-dingtalk] %s\n' "$*"
}

fail() {
  printf '[setup-dingtalk] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"
}

backup_existing_config() {
  local config_path="$HOME/.openclaw/openclaw.json"
  if [[ -f "$config_path" ]]; then
    local backup_path="${config_path}.bak.$(date +%s)"
    cp "$config_path" "$backup_path"
    log "已备份旧配置: $backup_path"
  fi
}

install_node_if_missing() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    log '未检测到 Node.js，使用 Homebrew 安装...'
    brew update
    brew install node
    return
  fi

  fail '未检测到 Node.js，且系统没有 Homebrew。请先安装 Node.js LTS: https://nodejs.org/'
}

install_openclaw_cli() {
  if command -v openclaw >/dev/null 2>&1; then
    return
  fi

  log '安装 OpenClaw CLI (openclaw@latest)...'
  if ! npm install -g openclaw@latest; then
    log '普通权限安装失败，尝试 sudo npm install -g openclaw@latest ...'
    sudo npm install -g openclaw@latest
  fi
}

install_dingtalk_plugin() {
  local plugin_dir="$HOME/.openclaw/extensions/openclaw-dingtalk"
  if [[ -d "$plugin_dir" ]]; then
    log "检测到已存在插件目录，跳过安装: $plugin_dir"
    return
  fi

  log '安装钉钉插件 openclaw-dingtalk...'
  if ! openclaw plugins install openclaw-dingtalk; then
    if [[ -d "$plugin_dir" ]]; then
      log "插件目录已存在，按已安装处理: $plugin_dir"
      return
    fi
    fail '安装 openclaw-dingtalk 失败'
  fi
}

validate_required_env() {
  local missing=()

  for key in \
    LITELLM_API_KEY \
    DING_CLIENT_ID \
    DING_CLIENT_SECRET \
    DING_ROBOT_CODE \
    DING_CORP_ID \
    DING_AGENT_ID; do
    if [[ -z "${!key:-}" ]]; then
      missing+=("$key")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    printf '[setup-dingtalk] 缺少必填环境变量: %s\n' "${missing[*]}" >&2
    cat >&2 <<'EOF'
[setup-dingtalk] 用法示例:
  LITELLM_API_KEY='sk-xxx' \\
  DING_CLIENT_ID='dingxxx' \\
  DING_CLIENT_SECRET='xxx' \\
  DING_ROBOT_CODE='dingxxx' \\
  DING_CORP_ID='dingxxx' \\
  DING_AGENT_ID='123456789' \\
  bash scripts/setup-dingtalk.sh
EOF
    exit 2
  fi
}

write_bootstrap_config() {
  local gateway_token="$1"
  export GATEWAY_TOKEN="$gateway_token"

  node <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = os.homedir();
const configDir = path.join(home, '.openclaw');
const configPath = path.join(configDir, 'openclaw.json');

const bootstrapConfig = {
  gateway: {
    mode: 'local',
    bind: 'loopback',
    port: 18789,
    auth: {
      mode: 'token',
      token: process.env.GATEWAY_TOKEN,
    },
  },
};

fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(bootstrapConfig, null, 2)}\n`, 'utf8');
console.log(`[setup-dingtalk] 已写入临时引导配置: ${configPath}`);
NODE
}

write_config() {
  local gateway_token="$1"

  export GATEWAY_TOKEN="$gateway_token"
  export LITELLM_BASE_URL="${LITELLM_BASE_URL:-http://43.134.133.185:4000/}"
  export LITELLM_API="${LITELLM_API:-anthropic-messages}"
  export LITELLM_MODEL_ID="${LITELLM_MODEL_ID:-claude-sonnet-4-6}"
  export LITELLM_MODEL_NAME="${LITELLM_MODEL_NAME:-claude-sonnet-4-6}"

  node <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = os.homedir();
const configDir = path.join(home, '.openclaw');
const configPath = path.join(configDir, 'openclaw.json');

const config = {
  models: {
    mode: 'merge',
    providers: {
      litellm: {
        baseUrl: process.env.LITELLM_BASE_URL,
        apiKey: process.env.LITELLM_API_KEY,
        api: process.env.LITELLM_API,
        models: [
          {
            id: process.env.LITELLM_MODEL_ID,
            name: process.env.LITELLM_MODEL_NAME,
          },
        ],
      },
    },
  },
  gateway: {
    mode: 'local',
    bind: 'loopback',
    port: 18789,
    auth: {
      mode: 'token',
      token: process.env.GATEWAY_TOKEN,
    },
  },
  plugins: {
    enabled: true,
    allow: ['openclaw-dingtalk'],
    entries: {
      'openclaw-dingtalk': {
        enabled: true,
      },
    },
  },
  channels: {
    dingtalk: {
      enabled: true,
      clientId: process.env.DING_CLIENT_ID,
      clientSecret: process.env.DING_CLIENT_SECRET,
      robotCode: process.env.DING_ROBOT_CODE,
      corpId: process.env.DING_CORP_ID,
      agentId: process.env.DING_AGENT_ID,
      dmPolicy: 'open',
      groupPolicy: 'open',
      allowFrom: ['*'],
      groupAllowFrom: ['*'],
      messageType: 'markdown',
      debug: false,
    },
  },
};

fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(`[setup-dingtalk] 已写入配置: ${configPath}`);
NODE
}

restart_gateway() {
  log '同步 gateway 服务配置（install --force）...'
  openclaw gateway install --force

  log '重启 OpenClaw gateway...'
  if ! openclaw gateway restart; then
    log 'gateway restart 失败，尝试 stop + start ...'
    openclaw gateway stop || true
    openclaw gateway start
  fi
}

main() {
  install_node_if_missing
  require_cmd node
  require_cmd npm

  log "Node 版本: $(node --version)"
  log "npm 版本: $(npm --version)"

  install_openclaw_cli
  require_cmd openclaw
  log "OpenClaw 版本: $(openclaw --version)"

  validate_required_env

  local gateway_token="${OPENCLAW_GATEWAY_TOKEN:-$(openssl rand -hex 24)}"
  backup_existing_config
  write_bootstrap_config "$gateway_token"

  install_dingtalk_plugin

  write_config "$gateway_token"

  restart_gateway

  log '完成。可用以下命令测试网关:'
  printf 'curl http://localhost:18789 -H "Authorization: Bearer %s"\n' "$gateway_token"
}

main "$@"
