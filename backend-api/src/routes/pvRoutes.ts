import { Router, Request, Response } from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fetchPvData } from '../services/pvService';
import { runCalculation } from '../services/calcService';
import { runCalculationInWorker } from '../services/workerPool';
import { getCoordsFromPlz } from '../services/geocodeService';
import { PvRequest } from '../types/pvTypes';
import { validateAndSanitize } from '../validation/validateCalculationRequest';

const router = Router();
const tariffData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/tariffData.json'), 'utf-8'));

// ── Bestehender PVGIS-Endpunkt ────────────────────────────────────────────────
router.post('/pv', async (req: Request, res: Response) => {
  try {
    const { plz, peakpower, angle, aspect, loss } = req.body;
    if (!plz) {
      return res.status(400).json({ error: 'PLZ required' });
    }
    const { lat, lon } = getCoordsFromPlz(plz);
    const pvParams: PvRequest = {
      lat, lon,
      peakpower: peakpower ?? 5,
      angle: angle ?? 30,
      aspect: aspect ?? 0,
      loss: loss ?? 14
    };
    const hourlyData = await fetchPvData(pvParams);
    const annualYield = hourlyData.reduce((sum, item) => sum + item.P, 0) / 1000;
    res.json({
      success: true,
      data: {
        peakpower_kwp: pvParams.peakpower,
        annual_yield_kwh: annualYield,
        coordinates: { lat, lon },
        used_params: { peakpower: pvParams.peakpower, angle: pvParams.angle, aspect: pvParams.aspect, loss: pvParams.loss }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Kalkulationstool-Endpunkt ─────────────────────────────────────────────────
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    let sanitized;
    try {
      sanitized = validateAndSanitize(req.body);
    } catch (validationError: any) {
      return res.status(422).json({ success: false, error: validationError?.message ?? 'Ungültige Eingabedaten.' });
    }
    const result = await runCalculationInWorker(sanitized);
    res.json(result);
  } catch (error: any) {
    const isOverload = error?.message?.includes('überlastet');
    console.error(error);
    res.status(isOverload ? 503 : 500).json({ error: error?.message ?? 'Server error' });
  }
});

// ── Live-Marktpreis (aWATTar) ───────────────────────────────────────────────
router.get('/market-live', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    const start = now - (48 * 60 * 60 * 1000);
    // end=now+2h damit der aktuelle Stundenslot (start_timestamp=HH:00, end_timestamp=HH+1:00) sicher enthalten ist
    const end = now + (2 * 60 * 60 * 1000);
    const url = `https://api.awattar.de/v1/marketdata?start=${start}&end=${end}`;

    const response: any = await axios.get(url, { timeout: 8000 });
    const rows = response?.data?.data;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(502).json({ success: false, error: 'Keine Marktdaten von aWATTar erhalten.' });
    }

    // Suche den Slot mit dem größten start_timestamp <= now (aktuell laufender Preisslot)
    const currentRow = rows.reduce((best: any, row: any) => {
      const from = Number(row?.start_timestamp);
      if (!Number.isFinite(from) || from > now) return best;
      if (!best || from > Number(best.start_timestamp)) return row;
      return best;
    }, null as any) ?? rows[rows.length - 1];

    const marketprice = Number(currentRow?.marketprice);
    const startsAtMs = Number(currentRow?.start_timestamp);
    const endsAtMs = Number(currentRow?.end_timestamp);

    if (!Number.isFinite(marketprice) || !Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)) {
      return res.status(502).json({ success: false, error: 'Marktdaten unvollständig.' });
    }

    const currentCtPerKwh = marketprice / 10;
    const dynamicMarkupCt = Number(tariffData?.dynamicTariff?.spotMarkup_ct_per_kwh || 0);
    const dynamicTaxesCt = Number(tariffData?.dynamicTariff?.taxes_and_levies_ct_per_kwh || 0);
    const dynamicCurrentCtPerKwh = currentCtPerKwh + dynamicMarkupCt + dynamicTaxesCt;

    res.json({
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
    res.status(502).json({ success: false, error: 'Live-Marktdaten momentan nicht erreichbar.' });
  }
});

router.get('/market-history', async (req: Request, res: Response) => {
  try {
    const requestedHours = Number(req.query.hours ?? 168);
    const hours = Number.isFinite(requestedHours)
      ? Math.max(1, Math.min(24 * 365, Math.floor(requestedHours)))
      : 168;

    const now = Date.now();
    const start = now - (hours * 60 * 60 * 1000);
    const url = `https://api.awattar.de/v1/marketdata?start=${start}&end=${now}`;

    const response: any = await axios.get(url, { timeout: 10000 });
    const rows = response?.data?.data;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(502).json({ success: false, error: 'Keine historischen Marktdaten verfügbar.' });
    }

    const series = rows
      .map((row: any) => {
        const ts = Number(row?.start_timestamp);
        const marketprice = Number(row?.marketprice);
        if (!Number.isFinite(ts) || !Number.isFinite(marketprice)) {
          return null;
        }
        return {
          timestamp: new Date(ts).toISOString(),
          value_ct_per_kwh: Number((marketprice / 10).toFixed(3))
        };
      })
      .filter((row: any) => row !== null);

    res.json({
      success: true,
      data: {
        hours,
        series,
        source: 'aWATTar API (EPEX Day-Ahead)'
      }
    });
  } catch {
    res.status(502).json({ success: false, error: 'Historische Marktdaten momentan nicht erreichbar.' });
  }
});

export default router;