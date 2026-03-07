// SEC-05: Simple in-memory rate limiter — 30 AI requests per user per hour
const _rateLimitMap = new Map(); // userId → { count, windowStart }
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = _rateLimitMap.get(userId);
  if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW_MS) {
    _rateLimitMap.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 60000);
    return { allowed: false, remaining: 0, resetInMinutes: resetIn };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

exports.handler = async function(event) {
  const ALLOWED_ORIGINS = [
    'https://myfinanceai.netlify.app',
    'http://localhost:8888',
    'http://localhost:3000',
    'http://127.0.0.1:8888',
  ];
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  // SEC: Verify request comes from our origin
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  // SEC: Verify Supabase JWT token — только авторизованные пользователи
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: 'Unauthorized — token required' }),
    };
  }

  // Verify token with Supabase (skip on localhost — token may not be refreshed)
  const token = authHeader.slice(7);
  if (!isLocalhost) {
    try {
      const verifyResp = await fetch(
        `${process.env.SUPABASE_URL}/auth/v1/user`,
        { headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_ANON_KEY } }
      );
      if (!verifyResp.ok) {
        return {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          body: JSON.stringify({ error: 'Unauthorized — invalid token' }),
        };
      }
    } catch(e) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: 'Unauthorized — token verification failed' }),
      };
    }
  }

  // SEC-05: Rate limiting — get userId from token payload
  try {
    const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const userId = tokenPayload.sub;
    const rl = checkRateLimit(userId);
    if (!rl.allowed) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({
          error: `Превышен лимит запросов (${RATE_LIMIT_MAX}/час). Попробуй через ${rl.resetInMinutes} мин.`,
        }),
      };
    }
  } catch(_) {
    // If we can't parse the token, allow the request (token was already verified above)
  }

  try {
    const body = JSON.parse(event.body);

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: 'messages array is required' }),
      };
    }

    // Hard limit: prevent runaway costs from accidental large payloads
    const MAX_MESSAGES = 30;
    if (body.messages.length > MAX_MESSAGES) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: `Too many messages (max ${MAX_MESSAGES})` }),
      };
    }

    // Limit system prompt size
    if (body.system && body.system.length > 32000) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: 'System prompt too large' }),
      };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: body.system,
        messages: body.messages,
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
