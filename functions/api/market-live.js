import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tariffData = require('../../backend-api/dist/data/tariffData.json');

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export async function onRequest() {
  try {
    const now = Date.now();
    const start = now - (48 * 60 * 60 * 1000);
    const end = now + (2 * 60 * 60 * 1000);
    const url = `https://api.awattar.de/v1/marketdata?start=${start}&end=${end}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json();
    const rows = payload && payload.data;

    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse(502, { success: false, error: 'Keine Marktdaten von aWATTar erhalten.' });
    }

    const currentRow = rows.reduce((best, row) => {
      const from = Number(row && row.start_timestamp);
      if (!Number.isFinite(from) || from > now) return best;
      if (!best || from > Number(best.start_timestamp)) return row;
      return best;
    }, null) || rows[rows.length - 1];

    const marketprice = Number(currentRow && currentRow.marketprice);
    const startsAtMs = Number(currentRow && currentRow.start_timestamp);
    const endsAtMs = Number(currentRow && currentRow.end_timestamp);

    if (!Number.isFinite(marketprice) || !Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)) {
      return jsonResponse(502, { success: false, error: 'Marktdaten unvollstaendig.' });
    }

    const currentCtPerKwh = marketprice / 10;
    const dynamicMarkupCt = Number((tariffData.dynamicTariff && tariffData.dynamicTariff.spotMarkup_ct_per_kwh) || 0);
    const dynamicTaxesCt = Number((tariffData.dynamicTariff && tariffData.dynamicTariff.taxes_and_levies_ct_per_kwh) || 0);
    const dynamicCurrentCtPerKwh = currentCtPerKwh + dynamicMarkupCt + dynamicTaxesCt;

    return jsonResponse(200, {
      success: true,
      data: {
        current_ct_per_kwh: Number(currentCtPerKwh.toFixed(3)),
        dynamic_current_ct_per_kwh: Number(dynamicCurrentCtPerKwh.toFixed(3)),
        dynamic_markup_plus_taxes_ct_per_kwh: Number((dynamicMarkupCt + dynamicTaxesCt).toFixed(3)),
        marketprice_eur_per_mwh: Number(marketprice.toFixed(3)),
        startsAt: new Date(startsAtMs).toISOString(),
        endsAt: new Date(endsAtMs).toISOString(),
        source: 'aWATTar API (EPEX Day-Ahead)'
      }
    });
  } catch {
    return jsonResponse(502, { success: false, error: 'Live-Marktdaten momentan nicht erreichbar.' });
  }
}
