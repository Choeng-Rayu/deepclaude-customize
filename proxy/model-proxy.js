import { createServer } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { Transform } from 'stream';

const ANTHROPIC_FALLBACK = 'https://api.anthropic.com';
const MODEL_PATHS = ['/v1/messages'];
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per request

// OpenAI-only backends (use chat/completions instead of messages)
const OPENAI_BACKENDS = ['doubleword', 'nvidia'];

// Translate Anthropic request to OpenAI format
function anthropicToOpenAI(anthropicReq) {
    const messages = [];
    
    // Handle system prompt
    if (anthropicReq.system) {
        messages.push({ role: 'system', content: anthropicReq.system });
    }
    
    // Convert messages
    for (const msg of anthropicReq.messages || []) {
        if (typeof msg.content === 'string') {
            messages.push({ role: msg.role, content: msg.content });
        } else if (Array.isArray(msg.content)) {
            // Handle multi-part content
            const parts = [];
            let hasToolUse = false;
            let toolCalls = [];
            
            for (const block of msg.content) {
                if (block.type === 'text') {
                    parts.push(block.text);
                } else if (block.type === 'image') {
                    // Convert Anthropic image format to OpenAI format
                    if (block.source?.type === 'base64') {
                        parts.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${block.source.media_type};base64,${block.source.data}`
                            }
                        });
                    }
                } else if (block.type === 'tool_use') {
                    // Anthropic assistant message with tool_use
                    hasToolUse = true;
                    toolCalls.push({
                        id: block.id,
                        type: 'function',
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input)
                        }
                    });
                } else if (block.type === 'tool_result') {
                    // Anthropic user message with tool results - convert to tool role
                    messages.push({
                        role: 'tool',
                        tool_call_id: block.tool_use_id,
                        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
                    });
                }
            }
            
            if (hasToolUse) {
                // Assistant message with tool calls
                messages.push({
                    role: 'assistant',
                    content: parts.length > 0 ? parts.join('\n') : null,
                    tool_calls: toolCalls
                });
            } else if (parts.length > 0) {
                // Regular message with mixed content
                const content = parts.every(p => typeof p === 'string') 
                    ? parts.join('\n') 
                    : parts;
                messages.push({ role: msg.role, content });
            }
        }
    }
    
    const openaiReq = {
        model: anthropicReq.model,
        messages,
        max_tokens: anthropicReq.max_tokens,
        stream: anthropicReq.stream
    };
    
    // Optional parameters
    if (anthropicReq.temperature !== undefined) openaiReq.temperature = anthropicReq.temperature;
    if (anthropicReq.top_p !== undefined) openaiReq.top_p = anthropicReq.top_p;
    if (anthropicReq.top_k !== undefined) openaiReq.top_k = anthropicReq.top_k;
    if (anthropicReq.stop_sequences) openaiReq.stop = anthropicReq.stop_sequences;
    if (anthropicReq.presence_penalty !== undefined) openaiReq.presence_penalty = anthropicReq.presence_penalty;
    if (anthropicReq.frequency_penalty !== undefined) openaiReq.frequency_penalty = anthropicReq.frequency_penalty;
    if (anthropicReq.user) openaiReq.user = anthropicReq.user;
    if (anthropicReq.metadata) openaiReq.metadata = anthropicReq.metadata;
    
    // Tools
    if (anthropicReq.tools) {
        openaiReq.tools = anthropicReq.tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema
            }
        }));
        if (anthropicReq.tool_choice) {
            if (anthropicReq.tool_choice.type === 'auto') {
                openaiReq.tool_choice = 'auto';
            } else if (anthropicReq.tool_choice.type === 'any') {
                openaiReq.tool_choice = 'required';
            } else if (anthropicReq.tool_choice.type === 'tool') {
                openaiReq.tool_choice = {
                    type: 'function',
                    function: { name: anthropicReq.tool_choice.name }
                };
            }
        }
    }
    
    return openaiReq;
}

// Add NVIDIA-specific parameters to request
function addNvidiaParams(openaiReq) {
    openaiReq.chat_template_kwargs = { thinking: true };
    return openaiReq;
}

// Translate OpenAI response to Anthropic format
function openaiToAnthropic(openaiResp) {
    const choice = openaiResp.choices?.[0];
    if (!choice) return null;
    
    // Kimi puts response in reasoning field, not content
    const text = choice.message?.content || choice.message?.reasoning || '';
    const content = [];
    
    // Add text content if present
    if (text) {
        content.push({ type: 'text', text: text });
    }
    
    // Handle tool calls
    if (choice.message?.tool_calls) {
        for (const toolCall of choice.message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments || '{}')
            });
        }
    }
    
    return {
        id: openaiResp.id || 'msg_' + Date.now(),
        type: 'message',
        role: 'assistant',
        content: content.length > 0 ? content : [{ type: 'text', text: '' }],
        model: openaiResp.model,
        stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : 
                     choice.finish_reason === 'tool_calls' ? 'tool_use' : 
                     choice.finish_reason,
        usage: {
            input_tokens: openaiResp.usage?.prompt_tokens || 0,
            output_tokens: openaiResp.usage?.completion_tokens || 0
        }
    };
}

// Translate OpenAI streaming chunk to Anthropic SSE format
function openaiChunkToAnthropic(chunk, isFirst) {
    const events = [];
    
    if (isFirst) {
        events.push('event: message_start');
        events.push('data: ' + JSON.stringify({
            type: 'message_start',
            message: {
                id: chunk.id || 'msg_' + Date.now(),
                type: 'message',
                role: 'assistant',
                content: [],
                model: chunk.model,
                usage: { input_tokens: 0, output_tokens: 0 }
            }
        }));
        events.push('');
        events.push('event: content_block_start');
        events.push('data: ' + JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' }
        }));
        events.push('');
    }
    
    const delta = chunk.choices?.[0]?.delta;
    if (delta) {
        // Handle text content (including reasoning from Kimi)
        const text = delta.content || delta.reasoning || '';
        if (text) {
            events.push('event: content_block_delta');
            events.push('data: ' + JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: text }
            }));
            events.push('');
        }
        
        // Handle tool calls
        if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
                if (toolCall.function?.name) {
                    // Tool call start
                    events.push('event: content_block_start');
                    events.push('data: ' + JSON.stringify({
                        type: 'content_block_start',
                        index: 1,
                        content_block: {
                            type: 'tool_use',
                            id: toolCall.id,
                            name: toolCall.function.name,
                            input: {}
                        }
                    }));
                    events.push('');
                }
                if (toolCall.function?.arguments) {
                    // Tool arguments delta
                    events.push('event: content_block_delta');
                    events.push('data: ' + JSON.stringify({
                        type: 'content_block_delta',
                        index: 1,
                        delta: {
                            type: 'input_json_delta',
                            partial_json: toolCall.function.arguments
                        }
                    }));
                    events.push('');
                }
            }
        }
    }
    
    const finishReason = chunk.choices?.[0]?.finish_reason;
    if (finishReason) {
        events.push('event: content_block_stop');
        events.push('data: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }));
        events.push('');
        events.push('event: message_delta');
        events.push('data: ' + JSON.stringify({
            type: 'message_delta',
            delta: { 
                stop_reason: finishReason === 'stop' ? 'end_turn' : 
                            finishReason === 'tool_calls' ? 'tool_use' : 
                            finishReason 
            },
            usage: { output_tokens: chunk.usage?.completion_tokens || 0 }
        }));
        events.push('');
        events.push('event: message_stop');
        events.push('data: ' + JSON.stringify({ type: 'message_stop' }));
        events.push('');
    }
    
    return events.length > 0 ? events.join('\n') + '\n' : null;
}

const MODEL_REMAP = {
    deepseek: {
        'claude-opus-4-6':    'deepseek-v4-pro',
        'claude-opus-4-7':    'deepseek-v4-pro',
        'claude-sonnet-4-6':  'deepseek-v4-flash',
        'claude-sonnet-4-5-20250929': 'deepseek-v4-flash',
        'claude-haiku-4-5-20251001':  'deepseek-v4-flash',
    },
    openrouter: {
        'claude-opus-4-6':    'deepseek/deepseek-v4-pro',
        'claude-opus-4-7':    'deepseek/deepseek-v4-pro',
        'claude-sonnet-4-6':  'deepseek/deepseek-v4-flash',
        'claude-sonnet-4-5-20250929': 'deepseek/deepseek-v4-flash',
        'claude-haiku-4-5-20251001':  'deepseek/deepseek-v4-flash',
    },
    doubleword: {
        'claude-opus-4-6':    'moonshotai/Kimi-K2.6',
        'claude-opus-4-7':    'moonshotai/Kimi-K2.6',
        'claude-sonnet-4-6':  'moonshotai/Kimi-K2.6',
        'claude-sonnet-4-5-20250929': 'moonshotai/Kimi-K2.6',
        'claude-haiku-4-5-20251001':  'moonshotai/Kimi-K2.6',
    },
    nvidia: {
        'claude-opus-4-6':    'moonshotai/kimi-k2.6',
        'claude-opus-4-7':    'moonshotai/kimi-k2.6',
        'claude-sonnet-4-6':  'moonshotai/kimi-k2.6',
        'claude-sonnet-4-5-20250929': 'moonshotai/kimi-k2.6',
        'claude-haiku-4-5-20251001':  'moonshotai/kimi-k2.6',
    },
};

const PRICING_PER_M = {
    deepseek:   { input: 0.44,  output: 0.87 },
    openrouter: { input: 0.44,  output: 0.87 },
    fireworks:  { input: 1.74,  output: 3.48 },
    doubleword: { input: 0.44,  output: 0.87 },
    nvidia:     { input: 0.44,  output: 0.87 },
    anthropic:  { input: 3.00,  output: 15.00 },
    _single:    { input: 0.44,  output: 0.87 },
};

/**
 * Transform stream that intercepts SSE events and injects missing `usage`
 * fields. DeepSeek/OpenRouter may omit `usage` in message_start or
 * message_delta, which crashes Claude Code ("$.input_tokens" is undefined).
 */
class UsageNormalizer extends Transform {
    constructor(onUsage) {
        super();
        this._buf = '';
        this._onUsage = onUsage;
        this._inputTokens = 0;
        this._outputTokens = 0;
    }

    _transform(chunk, _enc, cb) {
        this._buf += chunk.toString();
        const parts = this._buf.split('\n\n');
        this._buf = parts.pop();
        for (const part of parts) {
            this.push(this._fix(part) + '\n\n');
        }
        cb();
    }

    _fix(event) {
        const m = event.match(/^data: (.+)$/m);
        if (!m) return event;
        try {
            const d = JSON.parse(m[1]);
            let changed = false;
            if (d.type === 'message_start' && d.message) {
                if (d.message.usage) {
                    this._inputTokens = d.message.usage.input_tokens || 0;
                } else {
                    d.message.usage = { input_tokens: 0, output_tokens: 0 };
                    changed = true;
                }
            }
            if (d.type === 'message_delta') {
                if (d.usage) {
                    this._outputTokens = d.usage.output_tokens || 0;
                } else {
                    d.usage = { output_tokens: 0 };
                    changed = true;
                }
            }
            if (changed) return event.replace(m[1], () => JSON.stringify(d));
        } catch { /* not JSON, pass through */ }
        return event;
    }

    _flush(cb) {
        if (this._buf.trim()) this.push(this._fix(this._buf) + '\n\n');
        if (this._onUsage) this._onUsage(this._inputTokens, this._outputTokens);
        cb();
    }
}

/**
 * Transform OpenAI SSE stream to Anthropic SSE format
 */
class OpenAIToAnthropicStream extends Transform {
    constructor(onUsage) {
        super();
        this._buf = '';
        this._onUsage = onUsage;
        this._isFirst = true;
        this._hasFinished = false;
        this._inputTokens = 0;
        this._outputTokens = 0;
    }

    _transform(chunk, _enc, cb) {
        this._buf += chunk.toString();
        const lines = this._buf.split('\n');
        this._buf = lines.pop() || '';
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            
            const data = trimmed.substring(6);
            if (data === '[DONE]') continue;
            
            try {
                const openaiChunk = JSON.parse(data);
                if (openaiChunk.usage) {
                    this._inputTokens = openaiChunk.usage.prompt_tokens || 0;
                    this._outputTokens = openaiChunk.usage.completion_tokens || 0;
                }
                
                // Only process finish events once
                if (openaiChunk.choices?.[0]?.finish_reason && this._hasFinished) {
                    continue;
                }
                
                const anthropicEvents = openaiChunkToAnthropic(openaiChunk, this._isFirst);
                if (anthropicEvents) {
                    this.push(anthropicEvents);
                    this._isFirst = false;
                    if (openaiChunk.choices?.[0]?.finish_reason) {
                        this._hasFinished = true;
                    }
                }
            } catch (err) {
                // Skip malformed chunks
            }
        }
        cb();
    }

    _flush(cb) {
        if (this._onUsage) this._onUsage(this._inputTokens, this._outputTokens);
        cb();
    }
}

/**
 * For non-streaming JSON responses, ensure `usage` exists.
 */
function normalizeJsonBody(buf) {
    try {
        const obj = JSON.parse(buf);
        if (obj.type === 'message' && !obj.usage) {
            obj.usage = { input_tokens: 0, output_tokens: 0 };
            return Buffer.from(JSON.stringify(obj));
        }
    } catch { /* not JSON */ }
    return buf;
}

function stripAllThinkingBlocks(body) {
    if (!body?.messages) return;
    for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        msg.content = msg.content.filter(b => b.type !== 'thinking');
    }
}

function stripUnsignedThinkingBlocks(body) {
    if (!body?.messages) return;
    for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        msg.content = msg.content.filter(
            block => block.type !== 'thinking' || block.signature
        );
    }
}

export function startModelProxy({ targetUrl, apiKey, startPort = 3200, backends, defaultMode }) {
    return new Promise((resolve, reject) => {
        const initialTarget = new URL(targetUrl);
        const initialBearer = targetUrl.includes('openrouter') || targetUrl.includes('fireworks') || targetUrl.includes('doubleword.ai') || targetUrl.includes('nvidia.com');

        // Auto-detect backend type from URL
        let detectedMode = '_single';
        if (targetUrl.includes('doubleword.ai')) detectedMode = 'doubleword';
        else if (targetUrl.includes('nvidia.com')) detectedMode = 'nvidia';
        else if (targetUrl.includes('openrouter')) detectedMode = 'openrouter';
        else if (targetUrl.includes('fireworks')) detectedMode = 'fireworks';
        else if (targetUrl.includes('deepseek')) detectedMode = 'deepseek';

        const allBackends = {};
        if (backends) {
            for (const [name, cfg] of Object.entries(backends)) {
                allBackends[name] = {
                    target: new URL(cfg.url),
                    apiKey: cfg.apiKey,
                    useBearer: cfg.url.includes('openrouter') || cfg.url.includes('fireworks') || cfg.url.includes('doubleword.ai') || cfg.url.includes('nvidia.com'),
                };
            }
        }
        const initialName = defaultMode || (backends ? 'anthropic' : detectedMode);
        const startBackend = initialName && initialName !== 'anthropic' && allBackends[initialName];

        const state = {
            mode: initialName || detectedMode,
            target: startBackend ? startBackend.target : initialTarget,
            apiKey: startBackend ? startBackend.apiKey : apiKey,
            useBearer: startBackend ? startBackend.useBearer : initialBearer,
            hadNonAnthropicSession: !!startBackend,
        };

        let reqCount = 0;
        const t0Global = Date.now();
        const costs = {};

        function recordUsage(backend, inputTokens, outputTokens) {
            if (!costs[backend]) costs[backend] = { input: 0, output: 0, requests: 0 };
            costs[backend].input += inputTokens || 0;
            costs[backend].output += outputTokens || 0;
            costs[backend].requests++;
        }

        function getCostSummary() {
            const summary = {};
            let totalActual = 0;
            let totalAnthropic = 0;
            for (const [backend, tokens] of Object.entries(costs)) {
                const p = PRICING_PER_M[backend] || PRICING_PER_M._single;
                const ap = PRICING_PER_M.anthropic;
                const actual = (tokens.input * p.input + tokens.output * p.output) / 1_000_000;
                const anthropicEq = (tokens.input * ap.input + tokens.output * ap.output) / 1_000_000;
                totalActual += actual;
                totalAnthropic += anthropicEq;
                summary[backend] = {
                    input_tokens: tokens.input,
                    output_tokens: tokens.output,
                    requests: tokens.requests,
                    cost: +actual.toFixed(4),
                    anthropic_equivalent: +anthropicEq.toFixed(4),
                };
            }
            return {
                backends: summary,
                total_cost: +totalActual.toFixed(4),
                anthropic_equivalent: +totalAnthropic.toFixed(4),
                savings: +((totalAnthropic - totalActual).toFixed(4)),
            };
        }

        function switchMode(name) {
            if (name === 'anthropic') {
                const prev = state.mode;
                state.mode = 'anthropic';
                state.target = new URL(ANTHROPIC_FALLBACK);
                state.apiKey = null;
                state.useBearer = false;
                return { mode: 'anthropic', previous: prev };
            }
            const b = allBackends[name];
            if (!b) return { error: `Unknown backend: ${name}. Valid: anthropic, ${Object.keys(allBackends).join(', ')}` };
            if (!b.apiKey) return { error: `API key not set for ${name}` };
            const prev = state.mode;
            state.mode = name;
            state.target = b.target;
            state.apiKey = b.apiKey;
            state.useBearer = b.useBearer;
            state.hadNonAnthropicSession = true;
            return { mode: name, previous: prev };
        }

        const server = createServer((clientReq, clientRes) => {
            const urlPath = clientReq.url.split('?')[0];

            // Control endpoints — /_proxy/* (never collides with /v1/*)
            if (urlPath.startsWith('/_proxy/')) {
                if (urlPath === '/_proxy/status') {
                    clientRes.writeHead(200, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify({
                        mode: state.mode,
                        uptime: Math.round((Date.now() - t0Global) / 1000),
                        requests: reqCount,
                    }));
                    return;
                }
                if (urlPath === '/_proxy/cost') {
                    clientRes.writeHead(200, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify(getCostSummary()));
                    return;
                }
                if (urlPath === '/_proxy/mode' && clientReq.method === 'POST') {
                    const origin = clientReq.headers['origin'] || '';
                    if (origin && !origin.startsWith('http://127.0.0.1') && !origin.startsWith('http://localhost')) {
                        clientRes.writeHead(403, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify({ error: 'Forbidden' }));
                        return;
                    }
                    const chunks = [];
                    let bodySize = 0;
                    clientReq.on('data', c => {
                        bodySize += c.length;
                        if (bodySize > 1024) { clientReq.destroy(); return; }
                        chunks.push(c);
                    });
                    clientReq.on('end', () => {
                        const body = Buffer.concat(chunks).toString();
                        const m = body.match(/backend=([a-z]+)/);
                        if (!m) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify({ error: 'Missing backend= in body' }));
                            return;
                        }
                        const result = switchMode(m[1]);
                        if (result.error) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify(result));
                            return;
                        }
                        console.log(`[MODEL-PROXY] Mode switched: ${result.previous} → ${result.mode}`);
                        clientRes.writeHead(200, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify(result));
                    });
                    return;
                }
                if (urlPath === '/_proxy/mode' && clientReq.method !== 'POST') {
                    clientRes.writeHead(405, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify({ error: 'Use POST' }));
                    return;
                }
                clientRes.writeHead(404, { 'content-type': 'application/json' });
                clientRes.end(JSON.stringify({ error: 'Not found' }));
                return;
            }

            // In anthropic mode, everything passes through transparently
            const isAnthropicMode = state.mode === 'anthropic';
            const isModelCall = !isAnthropicMode && MODEL_PATHS.includes(urlPath);
            const dest = isModelCall ? state.target : new URL(ANTHROPIC_FALLBACK);

            // Build upstream path. target.pathname may overlap with
            // clientReq.url (e.g. OpenRouter /api/v1 + /v1/messages).
            // Strip the shared prefix to avoid /api/v1/v1/messages.
            let fullPath;
            if (isModelCall) {
                const base = state.target.pathname.replace(/\/$/, '');
                let overlap = '';
                for (let i = 1; i <= Math.min(base.length, urlPath.length); i++) {
                    if (base.endsWith(urlPath.substring(0, i))) overlap = urlPath.substring(0, i);
                }
                fullPath = overlap ? base + urlPath.substring(overlap.length) : base + urlPath;
            } else {
                fullPath = clientReq.url;
            }

            const reqId = ++reqCount;
            const t0 = Date.now();

            if (isModelCall) {
                console.log(`[MODEL-PROXY] #${reqId} → ${dest.hostname}${fullPath}`);
            }

            const headers = { ...clientReq.headers, host: dest.host };
            delete headers['content-length'];

            if (isModelCall) {
                delete headers['authorization'];
                delete headers['x-api-key'];
                if (state.useBearer) {
                    headers['authorization'] = `Bearer ${state.apiKey}`;
                } else {
                    headers['x-api-key'] = state.apiKey;
                }
            }

            const chunks = [];
            clientReq.on('data', c => chunks.push(c));
            clientReq.on('end', () => {
                let body = Buffer.concat(chunks);
                let useOpenAIFormat = false;

                // Check if this backend needs OpenAI format translation
                if (isModelCall && OPENAI_BACKENDS.includes(state.mode)) {
                    useOpenAIFormat = true;
                }

                // Remap Anthropic model names to backend-specific names
                if (isModelCall && MODEL_REMAP[state.mode]) {
                    try {
                        const parsed = JSON.parse(body);
                        const mapped = MODEL_REMAP[state.mode][parsed.model];
                        if (mapped) {
                            console.log(`[MODEL-PROXY] #${reqId} model remap: ${parsed.model} → ${mapped}`);
                            parsed.model = mapped;
                            body = Buffer.from(JSON.stringify(parsed));
                        }
                    } catch { /* not JSON or parse error, pass through */ }
                }

                // Translate Anthropic format to OpenAI format if needed
                if (useOpenAIFormat && isModelCall) {
                    try {
                        const anthropicReq = JSON.parse(body);
                        let openaiReq = anthropicToOpenAI(anthropicReq);
                        
                        // Add NVIDIA-specific parameters
                        if (state.mode === 'nvidia') {
                            openaiReq = addNvidiaParams(openaiReq);
                        }
                        
                        body = Buffer.from(JSON.stringify(openaiReq));
                        console.log(`[MODEL-PROXY] #${reqId} translated Anthropic → OpenAI format`);
                    } catch (err) {
                        console.error(`[MODEL-PROXY] #${reqId} translation error:`, err.message);
                    }
                }

                // Strip thinking blocks before forwarding.
                // Non-Anthropic: strip ALL blocks — backends reject thinking blocks
                // they didn't generate, even unsigned ones.
                // Anthropic after a non-Anthropic session: also strip ALL, because
                // foreign backends generate signed-but-invalid thinking blocks that
                // stripUnsignedThinkingBlocks passes through, causing Anthropic 400s.
                if (isAnthropicMode && MODEL_PATHS.includes(urlPath)) {
                    try {
                        const parsed = JSON.parse(body);
                        if (state.hadNonAnthropicSession) {
                            stripAllThinkingBlocks(parsed);
                        } else {
                            stripUnsignedThinkingBlocks(parsed);
                        }
                        body = Buffer.from(JSON.stringify(parsed));
                    } catch { /* pass through */ }
                }
                if (isModelCall && !useOpenAIFormat) {
                    try {
                        const parsed = JSON.parse(body);
                        stripAllThinkingBlocks(parsed);
                        body = Buffer.from(JSON.stringify(parsed));
                    } catch { /* pass through */ }
                }

                // Change path to /chat/completions for OpenAI format
                let requestPath = fullPath;
                if (useOpenAIFormat && isModelCall) {
                    requestPath = fullPath.replace('/v1/messages', '/v1/chat/completions');
                    console.log(`[MODEL-PROXY] #${reqId} path: ${fullPath} → ${requestPath}`);
                }

                const opts = {
                    hostname: dest.hostname,
                    port: dest.port || 443,
                    path: requestPath,
                    method: clientReq.method,
                    headers: { ...headers, 'content-length': body.length },
                    timeout: REQUEST_TIMEOUT_MS,
                };

                const proxyReq = httpsRequest(opts, (proxyRes) => {
                    if (isModelCall) {
                        const ttfb = Date.now() - t0;
                        console.log(`[MODEL-PROXY] #${reqId} TTFB ${ttfb}ms (status ${proxyRes.statusCode})`);
                    }

                    const ct = proxyRes.headers['content-type'] || '';
                    const isSSE = ct.includes('text/event-stream');

                    if (isModelCall && isSSE) {
                        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                        if (useOpenAIFormat) {
                            // Translate OpenAI SSE to Anthropic SSE
                            const translator = new OpenAIToAnthropicStream((inp, out) => recordUsage(state.mode, inp, out));
                            proxyRes.pipe(translator).pipe(clientRes);
                            proxyRes.on('end', () => {
                                console.log(`[MODEL-PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${translator._inputTokens}in/${translator._outputTokens}out)`);
                            });
                        } else {
                            const norm = new UsageNormalizer((inp, out) => recordUsage(state.mode, inp, out));
                            proxyRes.pipe(norm).pipe(clientRes);
                            proxyRes.on('end', () => {
                                console.log(`[MODEL-PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${norm._inputTokens}in/${norm._outputTokens}out)`);
                            });
                        }
                    } else if (isModelCall && ct.includes('application/json')) {
                        const respChunks = [];
                        proxyRes.on('data', c => respChunks.push(c));
                        proxyRes.on('end', () => {
                            const raw = Buffer.concat(respChunks);
                            let responseBody = raw;
                            
                            if (useOpenAIFormat) {
                                // Translate OpenAI JSON to Anthropic JSON
                                try {
                                    const openaiResp = JSON.parse(raw);
                                    const anthropicResp = openaiToAnthropic(openaiResp);
                                    if (anthropicResp) {
                                        responseBody = Buffer.from(JSON.stringify(anthropicResp));
                                        if (anthropicResp.usage) {
                                            recordUsage(state.mode, anthropicResp.usage.input_tokens, anthropicResp.usage.output_tokens);
                                        }
                                        console.log(`[MODEL-PROXY] #${reqId} translated OpenAI → Anthropic response`);
                                    }
                                } catch (err) {
                                    console.error(`[MODEL-PROXY] #${reqId} response translation error:`, err.message);
                                }
                            } else {
                                const fixed = normalizeJsonBody(raw);
                                try {
                                    const j = JSON.parse(fixed);
                                    if (j.usage) recordUsage(state.mode, j.usage.input_tokens, j.usage.output_tokens);
                                } catch {}
                                responseBody = fixed;
                            }
                            
                            const outHeaders = { ...proxyRes.headers, 'content-length': responseBody.length };
                            clientRes.writeHead(proxyRes.statusCode, outHeaders);
                            clientRes.end(responseBody);
                            console.log(`[MODEL-PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (json, ${responseBody.length}b)`);
                        });
                    } else {
                        // Non-model or unknown content-type: pass through
                        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                        proxyRes.pipe(clientRes);
                        if (isModelCall) {
                            proxyRes.on('end', () => {
                                console.log(`[MODEL-PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
                            });
                        }
                    }
                });

                proxyReq.on('timeout', () => {
                    console.error(`[MODEL-PROXY] #${reqId} TIMEOUT after ${REQUEST_TIMEOUT_MS / 1000}s`);
                    proxyReq.destroy(new Error('Request timeout'));
                });

                proxyReq.on('error', (err) => {
                    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
                    console.error(`[MODEL-PROXY] #${reqId} ERROR after ${elapsed}s: ${err.message}`);
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(502, { 'content-type': 'application/json' });
                    }
                    clientRes.end(JSON.stringify({ error: { message: 'Upstream connection error' } }));
                });

                proxyReq.end(body);
            });
        });

        function tryListen(port) {
            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' && port < startPort + 20) {
                    tryListen(port + 1);
                } else {
                    reject(err);
                }
            });
            server.listen(port, '127.0.0.1', () => {
                const actualPort = server.address().port;
                console.log(`[MODEL-PROXY] Listening on 127.0.0.1:${actualPort} → ${targetUrl} (mode: ${state.mode})`);
                resolve({ port: actualPort, close: () => server.close(), switchMode });
            });
        }

        tryListen(startPort);
    });
}
