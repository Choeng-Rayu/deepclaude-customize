#!/bin/bash
# Test Kimi Code API Key — reads from proxy/.env automatically
KEY=$(grep "^KIMI_API_KEY=" proxy/.env | cut -d= -f2 | sed "s/#.*//" | xargs)
echo "Testing Kimi Code API"
echo "Key: ${KEY:0:15}...${KEY: -4}"
echo "URL: https://api.kimi.com/coding/v1/messages (Anthropic protocol)"
echo ""
curl -s https://api.kimi.com/coding/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"kimi-for-coding","max_tokens":10,"messages":[{"role":"user","content":"say ok"}]}' | python3 -m json.tool 2>/dev/null || echo "Connection failed"
