exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const apiKey = process.env.GEMINI_API_KEY;

    // Convert messages to Gemini format
    const contents = [];

    // Add system prompt as first user message
    if (body.system) {
      contents.push({ role: 'user', parts: [{ text: body.system }] });
      contents.push({ role: 'model', parts: [{ text: 'Понял, буду следовать инструкциям.' }] });
    }

    // Add conversation messages
    for (const msg of body.messages) {
      const parts = [];
      if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text });
          } else if (item.type === 'image') {
            parts.push({ inlineData: { mimeType: item.source.media_type, data: item.source.data } });
          }
        }
      } else {
        parts.push({ text: msg.content || '' });
      }
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      }
    );

    const data = await response.json();

    if (data.error) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data.error.message })
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Return in same format as Anthropic so frontend works without changes
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ content: [{ type: 'text', text }] }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
