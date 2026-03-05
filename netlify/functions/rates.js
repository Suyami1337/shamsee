// netlify/functions/rates.js
// Fetches live exchange rates for all supported currencies vs RUB
// Uses open.er-api.com free tier (no key required, updates daily)

exports.handler = async function() {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  // All currencies the app supports (except RUB which is base)
  const SUPPORTED = ['SAR', 'USD', 'EUR', 'GBP', 'AED', 'TRY', 'CNY', 'KZT'];
  // USDT tracks USD price
  const USDT_PROXY = 'USD';

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/RUB', {
      headers: { 'User-Agent': 'MyFinanceAI/1.0' }
    });

    if (!res.ok) throw new Error(`API status ${res.status}`);
    const data = await res.json();
    if (!data.rates) throw new Error('No rates in response');

    // data.rates[X] = how many X per 1 RUB
    // We need: how many RUB per 1 X = 1 / data.rates[X]
    const result = {};
    for (const cur of SUPPORTED) {
      if (data.rates[cur]) {
        result[cur] = parseFloat((1 / data.rates[cur]).toFixed(4));
      }
    }
    // USDT = USD rate (closest proxy)
    if (data.rates[USDT_PROXY]) {
      result['USDT'] = parseFloat((1 / data.rates[USDT_PROXY]).toFixed(4));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...result,
        updatedAt: data.time_last_update_utc || new Date().toUTCString(),
        source:    'open.er-api.com',
      }),
    };

  } catch (err) {
    console.error('rates.js error:', err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        SAR: 20.5, USD: 90.0, USDT: 90.0, EUR: 98.0,
        GBP: 115.0, AED: 24.5, TRY: 2.8, CNY: 12.5, KZT: 0.19,
        updatedAt: null,
        source: 'fallback',
        error:  err.message,
      }),
    };
  }
};
