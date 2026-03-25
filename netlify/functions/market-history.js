function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}

exports.handler = async (event) => {
  try {
    const requestedHours = Number((event.queryStringParameters && event.queryStringParameters.hours) || 168);
    const hours = Number.isFinite(requestedHours)
      ? Math.max(1, Math.min(24 * 365, Math.floor(requestedHours)))
      : 168;

    const now = Date.now();
    const start = now - (hours * 60 * 60 * 1000);
    const url = `https://api.awattar.de/v1/marketdata?start=${start}&end=${now}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const payload = await response.json();
    const rows = payload && payload.data;

    if (!Array.isArray(rows) || rows.length === 0) {
      return json(502, { success: false, error: 'Keine historischen Marktdaten verfuegbar.' });
    }

    const series = rows
      .map((row) => {
        const ts = Number(row && row.start_timestamp);
        const marketprice = Number(row && row.marketprice);
        if (!Number.isFinite(ts) || !Number.isFinite(marketprice)) {
          return null;
        }
        return {
          timestamp: new Date(ts).toISOString(),
          value_ct_per_kwh: Number((marketprice / 10).toFixed(3))
        };
      })
      .filter((row) => row !== null);

    return json(200, {
      success: true,
      data: {
        hours,
        series,
        source: 'aWATTar API (EPEX Day-Ahead)'
      }
    });
  } catch {
    return json(502, { success: false, error: 'Historische Marktdaten momentan nicht erreichbar.' });
  }
};
