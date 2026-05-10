# How to Start deepclaude

## Quick Start

### 1. Set Your API Key

```bash
# For DoubleWord AI (DeepSeek V4 Pro)
export DOUBLEWORD_API_KEY="your api key"

# For NVIDIA (Kimi K2.6)
export NVIDIA_API_KEY="your-nvidia-key-here"

# For Kimi / Moonshot AI Direct (Kimi K2.6)
export MOONSHOT_API_KEY="your-moonshot-key-here"

# For DeepSeek (DeepSeek V4 Pro, native Anthropic format)
export DEEPSEEK_API_KEY="your-deepseek-key-here"

# Make it permanent (add to ~/.bashrc)
echo 'export DOUBLEWORD_API_KEY="your api key"' >> ~/.bashrc
source ~/.bashrc
```

### 2. Launch deepclaude 

quick: export DOUBLEWORD_API_KEY="your api key" && /home/rayu/deepclaude-customize/deepclaude.sh -b dw

```bash
cd /home/rayu/deepclaude-customize

# Use DoubleWord AI (DeepSeek V4 Pro)
./deepclaude.sh -b dw

# Use NVIDIA (Kimi K2.6)
./deepclaude.sh -b nv

# Use Kimi / Moonshot AI (Kimi K2.6)
./deepclaude.sh -b kimi

# Use DeepSeek V4 Pro (native Anthropic format)
./deepclaude.sh -b ds

# Use OpenRouter
./deepclaude.sh -b or

# Use Fireworks AI
./deepclaude.sh -b fw

# Use original Claude (Anthropic)
./deepclaude.sh -b anthropic
```

### 3. Check Status

```bash
./deepclaude.sh --status
```

This shows:
- Which API keys are set
- Available backends
- Proxy status

## Remote Control (Browser Mode)

Launch Claude Code in your browser:

```bash
# DoubleWord + Browser
./deepclaude.sh --remote -b dw

# NVIDIA + Browser
./deepclaude.sh --remote -b nv

# DeepSeek + Browser
./deepclaude.sh --remote -b ds
```

Opens a URL like: `https://claude.ai/code/session_...`

## Switch Providers Mid-Session

### Option 1: Slash Commands

Create files in `~/.claude/commands/`:

**doubleword.md:**
```
Switch to DoubleWord AI. Run:
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=doubleword"
```

**nvidia.md:**
```
Switch to NVIDIA. Run:
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=nvidia"
```

Then type `/doubleword` or `/nvidia` in Claude Code.

### Option 2: CLI Command

```bash
./deepclaude.sh --switch dw    # Switch to DoubleWord
./deepclaude.sh --switch nv    # Switch to NVIDIA
./deepclaude.sh --switch ds    # Switch to DeepSeek
```

## All Available Backends

| Flag | Provider | Model | Notes |
|------|----------|-------|-------|
| `ds` | DeepSeek | V4 Pro | Original, Anthropic-compatible |
| `or` | OpenRouter | DeepSeek V4 | Cheapest |
| `fw` | Fireworks | DeepSeek V4 | Fastest |
| `dw` | DoubleWord | Kimi K2.6 | **NEW** - OpenAI format |
| `nv` | NVIDIA | Kimi K2.6 | **NEW** - OpenAI format |
| `anthropic` | Anthropic | Claude Opus | Original Claude |

## Examples

```bash
# Basic usage
./deepclaude.sh -b dw

# Remote control
./deepclaude.sh --remote -b dw

# Check pricing
./deepclaude.sh --cost

# View status
./deepclaude.sh --status

# Help
./deepclaude.sh --help
```

## What Works

✅ File operations (read, write, edit)
✅ Bash commands
✅ Multi-turn conversations
✅ Tool calling
✅ Streaming responses
✅ Context preservation
✅ Images (base64)
✅ Subagents

## Troubleshooting

**"API key not set" error:**
```bash
# Check if key is set
echo $DOUBLEWORD_API_KEY

# Set it again
export DOUBLEWORD_API_KEY="your-key-here"
```

**"Permission denied" error:**
```bash
chmod +x ./deepclaude.sh
```

**Port already in use:**
```bash
# Kill existing proxy
pkill -9 node

# Or use different port (automatic)
./deepclaude.sh -b dw
```

## Notes

- DoubleWord and NVIDIA use **OpenAI format** (automatically translated)
- DeepSeek, OpenRouter, Fireworks use **Anthropic format** (native)
- All providers support the same features through translation layer
- Cost tracking available at: `curl http://127.0.0.1:3200/_proxy/cost`
