// netlify/functions/rates.js
// Fetches live exchange rates: SAR/RUB, USDT/RUB, USD/RUB
// Uses ExchangeRate-API free tier (no key required, updates ~daily)
// Fallback: last known rates if API is unavailable

exports.handler = async function() {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    // Get rates based on RUB — one request gives us all currencies vs RUB
    const res = await fetch('https://open.er-api.com/v6/latest/RUB', {
      headers: { 'User-Agent': 'MyFinanceAI/1.0' }
    });

    if (!res.ok) throw new Error(`API status ${res.status}`);
    const data = await res.json();

    if (!data.rates) throw new Error('No rates in response');

    // rates are X per 1 RUB, so 1 SAR = 1/rates.SAR RUB
    const sarPerRub  = data.rates['SAR'];   // e.g. 0.049 SAR per 1 RUB
    const usdtPerRub = data.rates['USD'];   // using USD as proxy for USDT
    const usdPerRub  = data.rates['USD'];

    if (!sarPerRub || !usdtPerRub) throw new Error('SAR or USD rate missing');

    const rubPerSar  = parseFloat((1 / sarPerRub).toFixed(4));
    const rubPerUsdt = parseFloat((1 / usdtPerRub).toFixed(4));
    const rubPerUsd  = parseFloat((1 / usdPerRub).toFixed(4));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        SAR:       rubPerSar,
        USDT:      rubPerUsdt,
        USD:       rubPerUsd,
        updatedAt: data.time_last_update_utc || new Date().toUTCString(),
        source:    'open.er-api.com',
      }),
    };

  } catch (err) {
    console.error('rates.js error:', err.message);
    // Return fallback rates with error flag so client can show warning
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        SAR:       20.5,
        USDT:      90.0,
        USD:       90.0,
        updatedAt: null,
        source:    'fallback',
        error:     err.message,
      }),
    };
  }
};
