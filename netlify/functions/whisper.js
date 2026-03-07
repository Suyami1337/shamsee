exports.handler = async function(event) {
  const ALLOWED_ORIGINS = ['https://myfinanceai.netlify.app','http://localhost:8888','http://localhost:3000','http://127.0.0.1:8888'];
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const ALLOWED_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  // SEC: Проверяем origin
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  // SEC: Проверяем JWT токен
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: 'Unauthorized — token required' }),
    };
  }

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

  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: 'GROQ_API_KEY not set in environment variables' }),
      };
    }

    const { audio, mimeType } = JSON.parse(event.body);
    if (!audio) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: 'No audio data' }),
      };
    }

    const MAX_BYTES = 19 * 1024 * 1024;
    const base64Bytes = audio.length * 0.75;
    if (base64Bytes > MAX_BYTES) {
      return {
        statusCode: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: 'Аудио слишком большое (лимит ~19 МБ). Запишите более короткое сообщение.' }),
      };
    }

    const audioBuffer = Buffer.from(audio, 'base64');
    const mt = (mimeType || '').toLowerCase();
    const ext = (mt.includes('mp4') || mt.includes('m4a')) ? 'm4a'
              : mt.includes('ogg') ? 'ogg'
              : mt.includes('wav') ? 'wav'
              : 'webm';
    const filename = 'audio.' + ext;
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

    const preamble = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType || 'audio/webm'}\r\n\r\n`
    );
    const rest = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `whisper-large-v3-turbo` +
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `ru` +
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `json` +
      `\r\n--${boundary}--\r\n`
    );

    const body = Buffer.concat([preamble, audioBuffer, rest]);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ error: data.error?.message || 'Groq API error' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ text: data.text }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
