function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export async function onRequest({ request }) {
  try {
    const url = new URL(request.url);
    const requestedHours = Number(url.searchParams.get('hours') || 168);
    const hours = Number.isFinite(requestedHours)
      ? Math.max(1, Math.min(24 * 365, Math.floor(requestedHours)))
      : 168;

    const now = Date.now();
    const start = now - (hours * 60 * 60 * 1000);
    const apiUrl = `https://api.awattar.de/v1/marketdata?start=${start}&end=${now}`;

    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
    const payload = await response.json();
    const rows = payload && payload.data;

    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse(502, { success: false, error: 'Keine historischen Marktdaten verfuegbar.' });
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

    return jsonResponse(200, {
      success: true,
      data: {
        hours,
        series,
        source: 'aWATTar API (EPEX Day-Ahead)'
      }
    });
  } catch {
    return jsonResponse(502, { success: false, error: 'Historische Marktdaten momentan nicht erreichbar.' });
  }
}
