# How to Start deepclaude

## Installation (One-Time Setup)

### 1. Set Your API Keys Permanently

```bash
# Add to your ~/.bashrc (so it's available everywhere)
echo 'export DOUBLEWORD_API_KEY="your api key"' >> ~/.bashrc
echo 'export NVIDIA_API_KEY="your-nvidia-key-here"' >> ~/.bashrc

# Reload your shell configuration
source ~/.bashrc

# Verify keys are set
echo $DOUBLEWORD_API_KEY
echo $NVIDIA_API_KEY
```

### 2. Create a Global Command (Optional but Recommended)

```bash
# Make deepclaude available from anywhere
sudo ln -s /home/rayu/deepclaude-customize/deepclaude.sh /usr/local/bin/deepclaude

# Or add to your PATH
echo 'export PATH="$PATH:/home/rayu/deepclaude-customize"' >> ~/.bashrc
source ~/.bashrc
```

## Daily Usage - From Any Project Directory

### Starting deepclaude in Your Project

```bash
# Navigate to your project
cd /path/to/your/project

# Start deepclaude with DoubleWord AI (Kimi K2.6)
/home/rayu/deepclaude-customize/deepclaude.sh -b dw

# Or if you created the global command:
deepclaude -b dw
```

### Full Command Examples

**From your project directory:**

```bash
# Example: Working on a web app
cd ~/projects/my-web-app
/home/rayu/deepclaude-customize/deepclaude.sh -b dw

# Example: Working on a Python project
cd ~/code/python-project
/home/rayu/deepclaude-customize/deepclaude.sh -b nv

# Example: Working on this deepclaude project itself
cd /home/rayu/deepclaude-customize
./deepclaude.sh -b dw
```

### All Backend Options

```bash
# DoubleWord AI (Kimi K2.6) - NEW
/home/rayu/deepclaude-customize/deepclaude.sh -b dw

# NVIDIA (Kimi K2.6) - NEW
/home/rayu/deepclaude-customize/deepclaude.sh -b nv

# DeepSeek V4 Pro (original)
/home/rayu/deepclaude-customize/deepclaude.sh -b ds

# OpenRouter (cheapest)
/home/rayu/deepclaude-customize/deepclaude.sh -b or

# Fireworks AI (fastest)
/home/rayu/deepclaude-customize/deepclaude.sh -b fw

# Original Claude (Anthropic)
/home/rayu/deepclaude-customize/deepclaude.sh -b anthropic
```

## Remote Control (Browser Mode)

Launch Claude Code in your browser from any project:

```bash
# Navigate to your project
cd /path/to/your/project

# Start remote control with DoubleWord
/home/rayu/deepclaude-customize/deepclaude.sh --remote -b dw

# Start remote control with NVIDIA
/home/rayu/deepclaude-customize/deepclaude.sh --remote -b nv

# Start remote control with DeepSeek
/home/rayu/deepclaude-customize/deepclaude.sh --remote -b ds
```

This will print a URL like:
```
https://claude.ai/code/session_abc123...
```

Open this URL in any browser (phone, tablet, another computer).

## Utility Commands

### Check Status

```bash
# Check which API keys are set and proxy status
/home/rayu/deepclaude-customize/deepclaude.sh --status
```

Output shows:
```
Keys:
  DEEPSEEK_API_KEY:    MISSING
  OPENROUTER_API_KEY:  MISSING
  FIREWORKS_API_KEY:   MISSING
  DOUBLEWORD_API_KEY:  set (****scMQ)
  NVIDIA_API_KEY:      MISSING

Backends:
  deepclaude -b dw    # DoubleWord AI (Kimi K2.6)
  deepclaude -b nv    # NVIDIA (Kimi K2.6)
  ...
```

### View Pricing

```bash
/home/rayu/deepclaude-customize/deepclaude.sh --cost
```

### Switch Provider Mid-Session

```bash
# While deepclaude is running in another terminal
/home/rayu/deepclaude-customize/deepclaude.sh --switch dw    # Switch to DoubleWord
/home/rayu/deepclaude-customize/deepclaude.sh --switch nv    # Switch to NVIDIA
/home/rayu/deepclaude-customize/deepclaude.sh --switch ds    # Switch to DeepSeek
```

## Creating Aliases (Recommended)

Add to your `~/.bashrc` for easier access:

```bash
# Add these lines to ~/.bashrc
alias dc-dw='/home/rayu/deepclaude-customize/deepclaude.sh -b dw'
alias dc-nv='/home/rayu/deepclaude-customize/deepclaude.sh -b nv'
alias dc-ds='/home/rayu/deepclaude-customize/deepclaude.sh -b ds'
alias dc-status='/home/rayu/deepclaude-customize/deepclaude.sh --status'
alias dc-remote-dw='/home/rayu/deepclaude-customize/deepclaude.sh --remote -b dw'
alias dc-remote-nv='/home/rayu/deepclaude-customize/deepclaude.sh --remote -b nv'
```

Then reload:
```bash
source ~/.bashrc
```

Now you can use short commands from anywhere:
```bash
cd ~/my-project
dc-dw              # Start with DoubleWord
dc-nv              # Start with NVIDIA
dc-status          # Check status
dc-remote-dw       # Remote control with DoubleWord
```

## Typical Workflow

### 1. Start Your Day

```bash
# Check which keys are available
/home/rayu/deepclaude-customize/deepclaude.sh --status
```

### 2. Work on a Project

```bash
# Navigate to your project
cd ~/projects/my-app

# Start deepclaude with your preferred provider
/home/rayu/deepclaude-customize/deepclaude.sh -b dw

# Now you can:
# - Ask questions about your code
# - Request file edits
# - Run bash commands
# - Generate new code
# - Debug issues
```

### 3. Switch Projects

```bash
# Exit current session (Ctrl+C or type 'exit')

# Go to another project
cd ~/projects/another-app

# Start again
/home/rayu/deepclaude-customize/deepclaude.sh -b nv
```

## Advanced: Slash Commands for Quick Switching

Create these files in `~/.claude/commands/`:

### ~/.claude/commands/doubleword.md
```markdown
Switch the model proxy to DoubleWord AI. Run this command silently and report the result:
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=doubleword"
If successful, say: "Switched to DoubleWord AI (Kimi K2.6)."
```

### ~/.claude/commands/nvidia.md
```markdown
Switch the model proxy to NVIDIA. Run this command silently and report the result:
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=nvidia"
If successful, say: "Switched to NVIDIA (Kimi K2.6)."
```

### ~/.claude/commands/deepseek.md
```markdown
Switch the model proxy to DeepSeek. Run this command silently and report the result:
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=deepseek"
If successful, say: "Switched to DeepSeek V4 Pro."
```

Then inside Claude Code, type:
- `/doubleword` - Switch to DoubleWord
- `/nvidia` - Switch to NVIDIA
- `/deepseek` - Switch to DeepSeek

## What You Can Do with deepclaude

Once started in your project directory, you can:

### File Operations
```
"Read the main.py file"
"Edit app.js and add error handling"
"Create a new file called config.yaml with these settings..."
"Show me all Python files in the src directory"
```

### Code Generation
```
"Write a function to parse JSON"
"Add unit tests for the User class"
"Refactor this code to use async/await"
"Generate a REST API endpoint for user authentication"
```

### Debugging
```
"Why is this function returning undefined?"
"Find the bug in this code"
"Explain what this error message means"
"Help me fix this TypeScript type error"
```

### Bash Commands
```
"Run npm install"
"Show me the git status"
"List all files modified in the last day"
"Run the test suite"
```

### Multi-Step Tasks
```
"Create a new React component with props and tests"
"Set up a database migration for the User table"
"Refactor the authentication system to use JWT"
"Add logging to all API endpoints"
```

## Provider Comparison

| Provider | Model | Format | Speed | Cost | Best For |
|----------|-------|--------|-------|------|----------|
| **DoubleWord** | Kimi K2.6 | OpenAI | Medium | Low | General coding |
| **NVIDIA** | Kimi K2.6 | OpenAI | Medium | Low | General coding |
| **DeepSeek** | V4 Pro | Anthropic | Fast | Low | Most tasks |
| **OpenRouter** | DeepSeek V4 | Anthropic | Fast | Lowest | Budget work |
| **Fireworks** | DeepSeek V4 | Anthropic | Fastest | Medium | Speed critical |
| **Anthropic** | Claude Opus | Native | Medium | Highest | Complex reasoning |

## Troubleshooting

### "Command not found"

```bash
# Use full path
/home/rayu/deepclaude-customize/deepclaude.sh -b dw

# Or make it executable
chmod +x /home/rayu/deepclaude-customize/deepclaude.sh
```

### "API key not set"

```bash
# Check if key is set
echo $DOUBLEWORD_API_KEY

# If empty, set it
export DOUBLEWORD_API_KEY="sk-pXR5dLdyiSCoxqtuiRXp2W0mQ8NNIFoMOpE3H9OscMQ"

# Make it permanent
echo 'export DOUBLEWORD_API_KEY="sk-pXR5dLdyiSCoxqtuiRXp2W0mQ8NNIFoMOpE3H9OscMQ"' >> ~/.bashrc
source ~/.bashrc
```

### "Port already in use"

```bash
# Kill existing proxy
pkill -9 node

# Wait a moment
sleep 2

# Try again
/home/rayu/deepclaude-customize/deepclaude.sh -b dw
```

### "Proxy not responding"

```bash
# Check proxy status
curl -s http://127.0.0.1:3200/_proxy/status

# If no response, restart deepclaude
# Press Ctrl+C to stop, then start again
```

### Check Proxy Logs

```bash
# View cost and usage
curl -s http://127.0.0.1:3200/_proxy/cost | jq .

# Check proxy status
curl -s http://127.0.0.1:3200/_proxy/status | jq .
```

## Quick Reference Card

```bash
# Start in current project
/home/rayu/deepclaude-customize/deepclaude.sh -b dw

# Remote control
/home/rayu/deepclaude-customize/deepclaude.sh --remote -b dw

# Check status
/home/rayu/deepclaude-customize/deepclaude.sh --status

# Switch provider
/home/rayu/deepclaude-customize/deepclaude.sh --switch nv

# View costs
curl -s http://127.0.0.1:3200/_proxy/cost | jq .
```

## Notes

- **Working Directory**: deepclaude works in whatever directory you launch it from
- **Context**: It has access to files in your current directory and subdirectories
- **Git**: It can see your git status and make commits
- **Tools**: All Claude Code tools work (file read/write, bash, grep, etc.)
- **Translation**: DoubleWord and NVIDIA use OpenAI format (automatically translated)
- **Streaming**: All providers support streaming responses
- **Cost**: Track usage at `http://127.0.0.1:3200/_proxy/cost`
