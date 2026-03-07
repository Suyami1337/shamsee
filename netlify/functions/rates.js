// netlify/functions/rates.js
// Fetches live exchange rates for all supported currencies vs RUB
// Uses open.er-api.com free tier (no key required, updates daily)

// In-memory cache — survives multiple calls within the same function instance (~10-30 min)
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

exports.handler = async function(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://myfinanceai.netlify.app',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://myfinanceai.netlify.app',
    // Tell Netlify CDN to cache this response for 1 hour
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
  };

  // Return in-memory cache if fresh
  if (_cache && (Date.now() - _cacheTs) < CACHE_TTL_MS) {
    console.log('rates.js: returning cached rates, age=', Math.round((Date.now() - _cacheTs) / 1000), 's');
    return { statusCode: 200, headers, body: JSON.stringify({ ..._cache, fromCache: true }) };
  }

  const SUPPORTED = ['SAR', 'USD', 'EUR', 'GBP', 'AED', 'TRY', 'CNY', 'KZT'];
  const USDT_PROXY = 'USD';

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/RUB', {
      headers: { 'User-Agent': 'MyFinanceAI/1.0' }
    });

    if (!res.ok) throw new Error(`API status ${res.status}`);
    const data = await res.json();
    if (!data.rates) throw new Error('No rates in response');

    // data.rates[X] = how many X per 1 RUB → invert to get RUB per X
    const result = {};
    for (const cur of SUPPORTED) {
      if (data.rates[cur]) {
        result[cur] = parseFloat((1 / data.rates[cur]).toFixed(4));
      }
    }
    if (data.rates[USDT_PROXY]) {
      // USDT is not on ER-API (not fiat). We proxy it to USD as a close approximation.
      result['USDT'] = parseFloat((1 / data.rates[USDT_PROXY]).toFixed(4));
    }

    const payload = {
      ...result,
      updatedAt: data.time_last_update_utc || new Date().toUTCString(),
      source: 'open.er-api.com',
      usdtIsProxy: true, // USDT rate = USD rate (approximation)
    };

    // Store in memory cache
    _cache = payload;
    _cacheTs = Date.now();

    return { statusCode: 200, headers, body: JSON.stringify(payload) };

  } catch (err) {
    console.error('rates.js error:', err.message);

    // Return stale cache if available rather than hardcoded fallback
    if (_cache) {
      console.log('rates.js: returning stale cache after error');
      return { statusCode: 200, headers, body: JSON.stringify({ ..._cache, fromCache: true, stale: true }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        SAR: 20.5, USD: 90.0, USDT: 90.0, EUR: 98.0,
        GBP: 115.0, AED: 24.5, TRY: 2.8, CNY: 12.5, KZT: 0.19,
        updatedAt: null,
        source: 'fallback',
        error: err.message,
      }),
    };
  }
};
