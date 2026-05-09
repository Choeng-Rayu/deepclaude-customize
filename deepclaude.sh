#!/usr/bin/env bash
# deepclaude — Use Claude Code with any LLM backend
# Configuration: proxy/.env (provider, keys, models)
# Usage: deepclaude [--backend <provider>] [--remote] [--status] [--cost] [--help]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/proxy/.env"

# --- Load .env ---
if [[ -f "$ENV_FILE" ]]; then
    # Source .env, skipping comments and empty lines
    set -a
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        # Trim whitespace and inline comments
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | sed 's/#.*//' | xargs)
        [[ -n "$key" && -n "$value" ]] && export "$key=$value"
    done < "$ENV_FILE"
    set +a
fi

# --- Provider URL Map ---
declare -A PROVIDER_URLS=(
    [doubleword]="https://api.doubleword.ai/v1"
    [nvidia]="https://integrate.api.nvidia.com/v1"
    [kimi]="https://api.moonshot.ai/v1"
    [deepseek]="https://api.deepseek.com/anthropic"
)

# --- Default backend from .env or fallback ---
BACKEND="${API_PROVIDER:-deepseek}"
# Normalize to lowercase
BACKEND=$(echo "$BACKEND" | tr '[:upper:]' '[:lower:]')

ACTION="launch"
SWITCH_BACKEND=""
PROXY_PID=""

# --- Parse args (override .env if provided) ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend|-b) BACKEND="$2"; shift 2 ;;
        --switch|-s)  ACTION="switch"; SWITCH_BACKEND="$2"; shift 2 ;;
        --remote|-r)  ACTION="remote"; shift ;;
        --status)     ACTION="status"; shift ;;
        --cost)       ACTION="cost"; shift ;;
        --help|-h)    ACTION="help"; shift ;;
        *)            break ;;
    esac
done

# Normalize backend aliases
case "$BACKEND" in
    dw) BACKEND="doubleword" ;;
    nv) BACKEND="nvidia" ;;
    ds) BACKEND="deepseek" ;;
esac

cleanup_proxy() {
    if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
        kill "$PROXY_PID" 2>/dev/null || true
        echo "  Proxy stopped."
    fi
}
trap cleanup_proxy EXIT

mask_key() {
    local k="$1"
    if [[ -z "$k" ]]; then echo "MISSING"; else echo "set (****${k: -4})"; fi
}

resolve_backend() {
    local url="" key="" model=""

    case "$BACKEND" in
        doubleword)
            key="${DOUBLEWORD_API_KEY:-}"
            url="${PROVIDER_URLS[doubleword]}"
            model="${DOUBLEWORD_MODEL:-deepseek-ai/DeepSeek-V4-Pro}"
            ;;
        nvidia)
            key="${NVIDIA_API_KEY:-}"
            url="${PROVIDER_URLS[nvidia]}"
            model="${NVIDIA_MODEL:-moonshotai/Kimi-K2.6}"
            ;;
        kimi)
            key="${KIMI_API_KEY:-}"
            url="${PROVIDER_URLS[kimi]}"
            model="${KIMI_MODEL:-kimi-k2.6}"
            ;;
        deepseek)
            key="${DEEPSEEK_API_KEY:-}"
            url="${PROVIDER_URLS[deepseek]}"
            model="${DEEPSEEK_MODEL:-deepseek-v4-pro}"
            ;;
        anthropic)
            # Native Claude Code — no proxy needed
            return 0
            ;;
        *)
            echo "ERROR: Unknown provider '$BACKEND'" >&2
            echo "  Supported: doubleword, nvidia, kimi, deepseek, anthropic" >&2
            echo "  Set API_PROVIDER in proxy/.env or use -b flag" >&2
            exit 1
            ;;
    esac

    [[ -z "$key" ]] && { echo "ERROR: ${BACKEND^^}_API_KEY not set in proxy/.env" >&2; exit 1; }

    RESOLVED_URL="$url"
    RESOLVED_KEY="$key"
    RESOLVED_MODEL="$model"
}

set_model_env() {
    # Use the model from .env for all Claude Code model slots
    export ANTHROPIC_DEFAULT_OPUS_MODEL="$RESOLVED_MODEL"
    export ANTHROPIC_DEFAULT_SONNET_MODEL="$RESOLVED_MODEL"
    export ANTHROPIC_DEFAULT_HAIKU_MODEL="$RESOLVED_MODEL"
    export CLAUDE_CODE_SUBAGENT_MODEL="$RESOLVED_MODEL"
    export CLAUDE_CODE_EFFORT_LEVEL="max"
    # Pass model to proxy for dynamic remapping
    export CHEAPCLAUDE_MODEL="$RESOLVED_MODEL"
}

show_status() {
    echo ""
    echo "  deepclaude — Configuration"
    echo "  ═══════════════════════════"
    echo ""
    echo "  .env file: $ENV_FILE"
    echo "  Active provider: ${API_PROVIDER:-not set}"
    echo ""
    echo "  Providers:"
    echo "    doubleword  Key: $(mask_key "${DOUBLEWORD_API_KEY:-}")  Model: ${DOUBLEWORD_MODEL:-not set}"
    echo "    nvidia      Key: $(mask_key "${NVIDIA_API_KEY:-}")  Model: ${NVIDIA_MODEL:-not set}"
    echo "    kimi        Key: $(mask_key "${KIMI_API_KEY:-}")  Model: ${KIMI_MODEL:-not set}"
    echo "    deepseek    Key: $(mask_key "${DEEPSEEK_API_KEY:-}")  Model: ${DEEPSEEK_MODEL:-not set}"
    echo ""
    echo "  Usage:"
    echo "    ./deepclaude.sh              # Uses API_PROVIDER from .env"
    echo "    ./deepclaude.sh -b nvidia    # Override with NVIDIA"
    echo "    ./deepclaude.sh -b anthropic # Use native Claude"
    echo ""
    local proxy_status
    proxy_status=$(curl -s http://127.0.0.1:3200/_proxy/status 2>/dev/null) || proxy_status=""
    if [[ -n "$proxy_status" ]]; then
        echo "  Proxy: running"
        echo "    $proxy_status"
    else
        echo "  Proxy: not running"
    fi
    echo ""
}

show_cost() {
    echo ""
    echo "  Provider Pricing (per 1M tokens)"
    echo "  ════════════════════════════════"
    echo ""
    echo "  Provider        Input      Output"
    echo "  ──────────      ────────   ────────"
    echo "  DoubleWord      \$0.44      \$0.87"
    echo "  NVIDIA          \$0.44      \$0.87"
    echo "  Kimi            \$0.44      \$0.87"
    echo "  DeepSeek        \$0.44      \$0.87"
    echo "  Anthropic       \$3.00      \$15.00"
    echo ""
}

show_help() {
    echo "deepclaude — Claude Code with any LLM backend"
    echo ""
    echo "Usage: deepclaude [options] [-- claude-args...]"
    echo ""
    echo "By default, reads provider/model from proxy/.env"
    echo ""
    echo "Options:"
    echo "  -b, --backend <provider>  Override provider (doubleword|nvidia|kimi|deepseek|anthropic)"
    echo "  -r, --remote              Remote control mode"
    echo "  --status                  Show configuration and provider keys"
    echo "  --cost                    Pricing comparison"
    echo "  -s, --switch <provider>   Switch proxy mid-session"
    echo "  -h, --help                This help"
    echo ""
    echo "Configuration: proxy/.env"
    echo "  API_PROVIDER=doubleword   # Active provider"
    echo "  DOUBLEWORD_API_KEY=...    # Provider API key"
    echo "  DOUBLEWORD_MODEL=...      # Model to use"
    echo ""
    echo "Supported providers:"
    echo "  doubleword  https://api.doubleword.ai      (OpenAI-compatible)"
    echo "  nvidia      https://integrate.api.nvidia.com (OpenAI-compatible)"
    echo "  kimi        https://api.moonshot.ai         (OpenAI-compatible)"
    echo "  deepseek    https://api.deepseek.com        (Anthropic-native)"
    echo "  anthropic   (native Claude Code, no proxy)"
}

do_switch() {
    local backend="$SWITCH_BACKEND"
    # Normalize
    case "$backend" in
        dw) backend="doubleword" ;;
        nv) backend="nvidia" ;;
        ds) backend="deepseek" ;;
    esac
    local resp
    resp=$(curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=$backend" 2>/dev/null) || {
        echo "  Proxy not running. Start with: ./deepclaude.sh" >&2; exit 1
    }
    echo "  $resp"
}

launch_claude() {
    if [[ "$BACKEND" == "anthropic" ]]; then
        echo "  Launching Claude Code (native Anthropic)..."
        unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
        unset ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL
        unset ANTHROPIC_DEFAULT_HAIKU_MODEL CLAUDE_CODE_SUBAGENT_MODEL
        unset CLAUDE_CODE_EFFORT_LEVEL
        exec claude "$@"
    fi

    resolve_backend

    echo ""
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║         deepclaude — Starting            ║"
    echo "  ╠══════════════════════════════════════════╣"
    echo "  ║  Provider: $(printf '%-29s' "$BACKEND")║"
    echo "  ║  Model:    $(printf '%-29s' "$RESOLVED_MODEL")║"
    echo "  ║  URL:      $(printf '%-29s' "$RESOLVED_URL")║"
    echo "  ╚══════════════════════════════════════════╝"
    echo ""

    local port_file
    port_file=$(mktemp)
    CHEAPCLAUDE_MODEL="$RESOLVED_MODEL" \
        node "$SCRIPT_DIR/proxy/start-proxy.js" "$RESOLVED_URL" "$RESOLVED_KEY" > "$port_file" 2>&1 &
    PROXY_PID=$!

    local tries=0
    while [[ $tries -lt 30 ]]; do
        if [[ -s "$port_file" ]]; then
            local last_line=$(tail -1 "$port_file")
            if [[ "$last_line" =~ ^[0-9]+$ ]]; then
                break
            fi
        fi
        sleep 0.2
        tries=$((tries + 1))
    done

    if [[ ! -s "$port_file" ]]; then
        echo "ERROR: Proxy failed to start" >&2
        cat "$port_file" >&2
        rm -f "$port_file"
        exit 1
    fi

    local proxy_port
    proxy_port=$(tail -1 "$port_file" | sed 's/\x1b\[[0-9;]*m//g')
    rm -f "$port_file"

    echo "  Proxy on :$proxy_port → $RESOLVED_URL"
    echo "  Launching Claude Code..."
    echo ""

    export ANTHROPIC_BASE_URL="http://127.0.0.1:$proxy_port"
    set_model_env
    unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

    claude "$@"
}

launch_remote() {
    if [[ "$BACKEND" == "anthropic" ]]; then
        echo "  Launching remote control (native Anthropic)..."
        unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
        unset ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL
        unset ANTHROPIC_DEFAULT_HAIKU_MODEL CLAUDE_CODE_SUBAGENT_MODEL
        unset CLAUDE_CODE_EFFORT_LEVEL ANTHROPIC_API_KEY
        exec claude remote-control "$@"
    fi

    resolve_backend

    echo "  Starting proxy for $BACKEND ($RESOLVED_MODEL)..."

    local port_file
    port_file=$(mktemp)
    CHEAPCLAUDE_MODEL="$RESOLVED_MODEL" \
        node "$SCRIPT_DIR/proxy/start-proxy.js" "$RESOLVED_URL" "$RESOLVED_KEY" > "$port_file" &
    PROXY_PID=$!

    local tries=0
    while [[ ! -s "$port_file" ]] && [[ $tries -lt 30 ]]; do
        sleep 0.2
        tries=$((tries + 1))
    done

    if [[ ! -s "$port_file" ]]; then
        echo "ERROR: Proxy failed to start" >&2
        rm -f "$port_file"
        exit 1
    fi

    local proxy_port
    proxy_port=$(head -1 "$port_file")
    rm -f "$port_file"

    echo "  Proxy on :$proxy_port → $RESOLVED_URL"
    echo "  Launching remote control..."
    echo ""

    export ANTHROPIC_BASE_URL="http://127.0.0.1:$proxy_port"
    set_model_env
    unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

    claude remote-control "$@"
}

# --- Main ---
case "$ACTION" in
    status)    show_status ;;
    cost)      show_cost ;;
    help)      show_help ;;
    switch)    do_switch ;;
    remote)    launch_remote "$@" ;;
    launch)    launch_claude "$@" ;;
esac
