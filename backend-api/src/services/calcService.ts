import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { getCoordsFromPlz } from './geocodeService';
import { fetchPvData } from './pvService';
import {
  CalculationRequest, CalculationResponse,
  MonthlyEnergy, TariffResult, ScenarioResult, TarifModul14a, LargeLoadConfig
} from '../types/pvTypes';

// ── JSON-Daten laden ─────────────────────────────────────────────────────────
const loadProfiles  = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/loadProfiles.json'),  'utf-8'));
const pvProfile     = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/pvProfile.json'),     'utf-8'));
const spotPrices    = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/spotPrices2025.json'),'utf-8'));
const tariffData    = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/tariffData.json'),    'utf-8'));

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DAYS_PER_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];

// ── Korrektur Ausrichtung/Neigung ─────────────────────────────────────────────
function getAspectFactor(aspect: number): number {
  const table = pvProfile.aspectCorrectionFactors as Record<string,number>;
  const keys = Object.keys(table).map(Number).sort((a,b)=>a-b);
  if (aspect <= keys[0]) return table[String(keys[0])];
  if (aspect >= keys[keys.length-1]) return table[String(keys[keys.length-1])];
  for (let i=0; i<keys.length-1; i++) {
    if (aspect >= keys[i] && aspect <= keys[i+1]) {
      const t = (aspect - keys[i]) / (keys[i+1] - keys[i]);
      return table[String(keys[i])] * (1-t) + table[String(keys[i+1])] * t;
    }
  }
  return 1.0;
}

function getAngleFactor(angle: number): number {
  const table = pvProfile.angleCorrectionFactors as Record<string,number>;
  const keys = Object.keys(table).map(Number).sort((a,b)=>a-b);
  if (angle <= keys[0]) return table[String(keys[0])];
  if (angle >= keys[keys.length-1]) return table[String(keys[keys.length-1])];
  for (let i=0; i<keys.length-1; i++) {
    if (angle >= keys[i] && angle <= keys[i+1]) {
      const t = (angle - keys[i]) / (keys[i+1] - keys[i]);
      return table[String(keys[i])] * (1-t) + table[String(keys[i+1])] * t;
    }
  }
  return 1.0;
}

// ── PV-Ertrag Stundenprofil generieren (8760 Werte in Wh) ─────────────────────
function generatePvHourly(peakpower_kwp: number, angle: number, aspect: number, loss_pct: number): number[] {
  const specificYield = pvProfile.specificYield_kwh_per_kwp as number;
  const aspectF = getAspectFactor(aspect);
  const angleF  = getAngleFactor(angle);
  const lossF   = 1 - (loss_pct / 100);
  const annualYield_kwh = peakpower_kwp * specificYield * aspectF * angleF * lossF;

  const hourly: number[] = [];
  for (let m=0; m<12; m++) {
    const monthFactor  = (pvProfile.monthlyYieldFactors as number[])[m];
    const monthKey     = MONTHS[m];
    const monthYield_kwh = (annualYield_kwh / 12) * monthFactor;
    const dayFactors   = pvProfile.hourlyYieldFactors[monthKey] as number[];
    const daySum       = dayFactors.reduce((a:number,b:number)=>a+b,0);
    const days         = DAYS_PER_MONTH[m];
    for (let d=0; d<days; d++) {
      for (let h=0; h<24; h++) {
        const val = daySum > 0
          ? (monthYield_kwh / days) * (dayFactors[h] / daySum) * 1000  // Wh
          : 0;
        hourly.push(Math.max(0, val));
      }
    }
  }
  return hourly;
}

// ── Verbrauchsprofil generieren (8760 Werte in Wh) ───────────────────────────
function getAnnualHouseholdConsumptionForPersons(persons: number): number {
  const lookup = loadProfiles.annualConsumption_kwh as Record<string, number>;
  const direct = Number(lookup[String(persons)]);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  if (persons <= 1) return 1500;
  if (persons <= 4) return 1500 + ((persons - 1) * 1000);
  return 5500 + ((persons - 5) * 800);
}

function getEVVehicles(req: CalculationRequest) {
  const vehicles = Array.isArray(req.emobility.vehicles) ? req.emobility.vehicles : [];
  if (vehicles.length) {
    return vehicles;
  }

  if (!req.emobility.hasEV) {
    return [];
  }

  return [{
    batteryCapacity_kwh: req.emobility.vehicles?.[0]?.batteryCapacity_kwh ?? 60,
    annualKm: req.emobility.annualKm ?? 12000,
    consumption_kwh_per_100km: req.emobility.consumption_kwh_per_100km ?? 20,
    wallboxPower_kw: req.emobility.chargingPower_kw ?? 11,
    useBidirectional: req.emobility.useBidirectional ?? false,
  }];
}

function getLargeLoads(req: CalculationRequest): LargeLoadConfig[] {
  const loads = Array.isArray(req.tariff.largeLoads) ? req.tariff.largeLoads : [];
  if (loads.length) {
    return loads;
  }
  const count = Math.max(0, Math.round(req.tariff.largeLoadCount ?? 0));
  const powerKw = Math.max(0, req.tariff.largeLoadPowerKw ?? 0);
  if (count > 0 && powerKw > 0) {
    return Array.from({ length: count }, () => ({ powerKw, startHour: 0, endHour: 0 }));
  }
  return [];
}

function buildLargeLoadDailyCurveKw(loads: LargeLoadConfig[]): number[] {
  const curve = Array.from({ length: 24 }, () => 0);
  loads.forEach((load) => {
    const powerKw = Math.max(0, load.powerKw ?? 0);
    const start = Math.min(23, Math.max(0, Math.round(load.startHour ?? 0)));
    const end = Math.min(23, Math.max(0, Math.round(load.endHour ?? 0)));
    for (let h = 0; h < 24; h++) {
      const active = start === end ? true : (start < end ? (h >= start && h < end) : (h >= start || h < end));
      if (active) {
        curve[h] += powerKw;
      }
    }
  });
  return curve;
}

function generateConsumptionHourly(req: CalculationRequest): number[] {
  const persons = req.household.persons;
  const buildingType = req.household.buildingType ?? 'EFH';
  const buildingFactor = buildingType === 'MFH' ? 3.0 : buildingType === 'Gewerbe' ? 6.0 : 1.0;
  const rawBase = req.household.annualConsumption_kwh
    ?? (getAnnualHouseholdConsumptionForPersons(persons) * buildingFactor);
  // Guard: must be a positive finite number; fall back to BDEW default for person-count
  const baseAnnual = (Number.isFinite(rawBase) && rawBase > 0)
    ? rawBase
    : (getAnnualHouseholdConsumptionForPersons(persons) * buildingFactor);

  let hpAnnual = 0;
  if (req.heatPump.hasHeatPump) {
    hpAnnual = req.heatPump.annualConsumption_kwh ?? 3000;
  }

  let evAnnual = 0;
  const evVehicles = getEVVehicles(req);
  const largeLoads = getLargeLoads(req);
  const largeLoadDailyCurveKw = buildLargeLoadDailyCurveKw(largeLoads);
  if (evVehicles.length) {
    evAnnual = evVehicles.reduce((sum, vehicle) => {
      const km = vehicle.annualKm ?? 12000;
      const cons = vehicle.consumption_kwh_per_100km ?? 20;
      const battery = vehicle.batteryCapacity_kwh ?? 60;
      const wallboxPower = vehicle.wallboxPower_kw ?? 11;
      const traction_kwh = (km / 100) * cons;
      // Wallbox and battery introduce charging overhead so every EV input influences annual demand.
      const wallboxLossFactor = wallboxPower <= 4.6 ? 1.12 : wallboxPower <= 11 ? 1.1 : 1.08;
      const batteryOverhead_kwh = battery * 3;
      const bidiCycleOverhead_kwh = vehicle.useBidirectional ? (traction_kwh * 0.02) : 0;
      return sum + (traction_kwh * wallboxLossFactor) + batteryOverhead_kwh + bidiCycleOverhead_kwh;
    }, 0);
  }

  const monthlyH0   = loadProfiles.monthlyFactors as number[];
  const hourlyH0    = loadProfiles.hourlyFactors   as number[];
  const monthlyHP   = loadProfiles.heatPumpMonthlyFactors as number[];
  const hourlyHP    = loadProfiles.heatPumpHourlyFactors  as number[];
  const hourlyEV    = (req.emobility.preferNightCharging !== false)
    ? loadProfiles.evChargingHourlyFactors_night as number[]
    : loadProfiles.evChargingHourlyFactors_day   as number[];

  const hpMonthSum  = monthlyHP.reduce((a:number,b:number)=>a+b,0);
  const h0HourSum   = hourlyH0.reduce((a:number,b:number)=>a+b,0);
  const hpHourSum   = hourlyHP.reduce((a:number,b:number)=>a+b,0);
  const evHourSum   = hourlyEV.reduce((a:number,b:number)=>a+b,0);

  const hourly: number[] = [];
  for (let m=0; m<12; m++) {
    const h0Month = (baseAnnual / 12) * monthlyH0[m];
    const hpMonth = hpAnnual > 0 ? (hpAnnual / hpMonthSum) * monthlyHP[m] : 0;
    const evMonth = evAnnual / 12;
    const days    = DAYS_PER_MONTH[m];
    for (let d=0; d<days; d++) {
      for (let h=0; h<24; h++) {
        const h0Val = (h0Month / days) * (hourlyH0[h] / h0HourSum);
        const hpVal = hpMonth > 0 ? (hpMonth / days) * (hourlyHP[h] / hpHourSum) : 0;
        const evVal = evAnnual > 0 ? (evMonth / days) * (hourlyEV[h] / evHourSum) : 0;
        const largeLoadVal = largeLoadDailyCurveKw[h] ?? 0; // kWh per hour (equivalent to kW over 1h)
        hourly.push((h0Val + hpVal + evVal + largeLoadVal) * 1000); // Wh
      }
    }
  }
  return hourly;
}

// ── Speicher-Simulation ──────────────────────────────────────────────────────
function simulateStorage(
  pvHourly: number[], consHourly: number[],
  capacity_kwh: number, maxPower_kw: number, efficiency: number,
  spotHourly: number[], useDynamic: boolean, spotAnnualAvgCt: number
): { gridDraw: number[]; gridFeed: number[]; selfCons: number[] } {
  const cap_wh  = capacity_kwh * 1000;
  const maxP_wh = maxPower_kw * 1000;
  let soc_wh    = cap_wh * 0.1; // Start bei 10% SOC

  const gridDraw: number[] = [];
  const gridFeed: number[] = [];
  const selfCons: number[] = [];

  for (let i=0; i<8760; i++) {
    const pv   = pvHourly[i];
    const cons = consHourly[i];
    let excess = pv - cons;

    if (excess >= 0) {
      // Überschuss → erst Speicher laden
      const canCharge  = Math.min(excess, maxP_wh, (cap_wh - soc_wh) / efficiency);
      const charged    = Math.max(0, canCharge);
      soc_wh          += charged * efficiency;
      const feedIn     = excess - charged;
      gridDraw.push(0);
      gridFeed.push(feedIn);
      selfCons.push(cons);
    } else {
      // Bedarf > Erzeugung → Speicher entladen
      const need       = -excess;
      // Bei dynamischer Optimierung: nur entladen wenn Preis hoch genug
      const priceHigh  = !useDynamic || spotHourly[i] > (spotAnnualAvgCt * 0.9);
      const canDischarge = priceHigh
        ? Math.min(need, maxP_wh, soc_wh * efficiency)
        : 0;
      const discharged = Math.max(0, canDischarge);
      soc_wh          -= discharged / efficiency;
      const draw       = need - discharged;
      gridDraw.push(Math.max(0, draw));
      gridFeed.push(0);
      selfCons.push(pv + discharged);
    }
  }
  return { gridDraw, gridFeed, selfCons };
}

// ── Spotpreis-Array aufbauen (8760 Werte in ct/kWh) ─────────────────────────
function buildSpotArrayStatic(): number[] {
  const arr: number[] = [];
  for (let m=0; m<12; m++) {
    const avgPrice   = (spotPrices.monthlyAvg_ct_per_kwh as number[])[m];
    const factors    = spotPrices.hourlyProfileFactors[MONTHS[m]] as number[];
    const days       = DAYS_PER_MONTH[m];
    for (let d=0; d<days; d++) {
      for (let h=0; h<24; h++) {
        arr.push(avgPrice * factors[h]);
      }
    }
  }
  return arr;
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildSpotArrayFromHourlyAverages(hourlyAvgCt: number[]): number[] {
  const arr: number[] = [];
  for (let m = 0; m < 12; m++) {
    const days = DAYS_PER_MONTH[m];
    for (let d = 0; d < days; d++) {
      for (let h = 0; h < 24; h++) {
        arr.push(hourlyAvgCt[h]);
      }
    }
  }
  return arr;
}

async function buildSpotArrayLiveOrFallback(): Promise<{
  spotArrCt: number[];
  hourlyAvgCt: number[];
  annualAvgCt: number;
  source: 'live-awattar' | 'fallback-static';
}> {
  try {
    const nowMs = Date.now();
    const lookbackMs = 48 * 60 * 60 * 1000;
    const startMs = nowMs - lookbackMs;
    const url = `https://api.awattar.de/v1/marketdata?start=${startMs}&end=${nowMs}`;

    const response: any = await axios.get(url, { timeout: 8000 });
    const rows = response?.data?.data;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('aWATTar response empty');
    }

    const latestByHour = new Map<number, number>();
    for (const row of rows) {
      const ts = Number(row?.start_timestamp);
      const marketPriceEurPerMwh = Number(row?.marketprice);
      if (!Number.isFinite(ts) || !Number.isFinite(marketPriceEurPerMwh)) continue;

      const hour = new Date(ts).getHours();
      // EUR/MWh -> ct/kWh: divide by 10
      const ctPerKwh = marketPriceEurPerMwh / 10;
      latestByHour.set(hour, ctPerKwh);
    }

    const knownValues = Array.from(latestByHour.values());
    const fallbackHourAvg = knownValues.length ? avg(knownValues) : (spotPrices.annualAvg_ct_per_kwh as number);
    const hourlyAvgCt = Array.from({ length: 24 }, (_, hour) => {
      return latestByHour.has(hour) ? (latestByHour.get(hour) as number) : fallbackHourAvg;
    });
    const spotArrCt = buildSpotArrayFromHourlyAverages(hourlyAvgCt);

    return {
      spotArrCt,
      hourlyAvgCt,
      annualAvgCt: avg(spotArrCt),
      source: 'live-awattar'
    };
  } catch {
    const spotArrCt = buildSpotArrayStatic();
    const hourlyBuckets: number[][] = Array.from({ length: 24 }, () => []);
    for (let i = 0; i < spotArrCt.length; i++) {
      const hour = i % 24;
      hourlyBuckets[hour].push(spotArrCt[i]);
    }
    const hourlyAvgCt = hourlyBuckets.map((vals) => vals.length ? avg(vals) : 0);

    return {
      spotArrCt,
      hourlyAvgCt,
      annualAvgCt: avg(spotArrCt),
      source: 'fallback-static'
    };
  }
}

// ── Netzentgelt nach Modul berechnen ─────────────────────────────────────────
function getNetworkCost_ct(hour: number, module14a: string): number {
  const base = tariffData.networkCosts;
  const non_network = base.concessionLevy_ct_per_kwh + base.section19levy_ct_per_kwh + base.offshoreLevy_ct_per_kwh + base.abilityLevy_ct_per_kwh;
  const h = hour % 24;
  // Modul 1: no per-unit change; only flat annual discount applies
  if (module14a === 'modul1') return base.total_ct_per_kwh;
  if (module14a === 'modul2') {
    const peak = tariffData.module14a.modul2.peakHours.includes(h);
    return (peak ? tariffData.module14a.modul2.peakNetworkTariff_ct_per_kwh : tariffData.module14a.modul2.offpeakNetworkTariff_ct_per_kwh) + non_network;
  }
  if (module14a === 'modul3') {
    const peak = Array.isArray(tariffData.module14a.modul3.peakHours) && tariffData.module14a.modul3.peakHours.includes(h);
    return (peak ? tariffData.module14a.modul3.peakNetworkTariff_ct_per_kwh : tariffData.module14a.modul3.offpeakNetworkTariff_ct_per_kwh) + non_network;
  }
  return base.total_ct_per_kwh;
}

// Gibt nur den Netzentgelt-Arbeitspreis zurück (ohne Umlagen/Abgaben).
// Wird für den dynamischen Tarif genutzt, weil die Umlagen bereits in taxes_and_levies enthalten sind.
function getNetworkTariffOnly_ct(hour: number, module14a: string): number {
  const base = tariffData.networkCosts;
  const h = hour % 24;
  if (module14a === 'modul1') return base.networkTariff_ct_per_kwh; // kein Per-Unit-Rabatt bei Modul 1
  if (module14a === 'modul2') {
    const peak = tariffData.module14a.modul2.peakHours.includes(h);
    return peak ? tariffData.module14a.modul2.peakNetworkTariff_ct_per_kwh : tariffData.module14a.modul2.offpeakNetworkTariff_ct_per_kwh;
  }
  if (module14a === 'modul3') {
    const peak = Array.isArray(tariffData.module14a.modul3.peakHours) && tariffData.module14a.modul3.peakHours.includes(h);
    return peak ? tariffData.module14a.modul3.peakNetworkTariff_ct_per_kwh : tariffData.module14a.modul3.offpeakNetworkTariff_ct_per_kwh;
  }
  return base.networkTariff_ct_per_kwh;
}

function getModuleLabel(module14a: TarifModul14a): string {
  if (module14a === 'none') return 'Kein §14a-Modul';
  return tariffData.module14a[module14a]?.label || 'Kein §14a-Modul';
}

function getTariffLabel(tariffType: 'static'|'dynamic'|'twoRate'): string {
  if (tariffType === 'dynamic') return tariffData.dynamicTariff.label;
  if (tariffType === 'twoRate') return tariffData.twoRateTariff.label;
  return tariffData.staticTariff.label;
}

function getCombinedTariffLabel(tariffType: 'static'|'dynamic'|'twoRate', module14a: TarifModul14a): string {
  const baseLabel = getTariffLabel(tariffType);
  if (module14a === 'none') return baseLabel;
  return `${baseLabel} + ${getModuleLabel(module14a)}`;
}

// ── Tarif-Kosten berechnen ────────────────────────────────────────────────────
function calcTariffCost(
  gridDraw: number[], gridFeed: number[], selfCons: number[],
  spotArr: number[], label: string, name: string,
  tariffType: 'static'|'dynamic'|'twoRate', module14a: TarifModul14a,
  peakpower_kwp: number, totalConsumption_kwh: number
): TariffResult {
  const isModuled   = module14a !== 'none';
  const isDynamic   = tariffType === 'dynamic';
  const isTwoRate   = tariffType === 'twoRate';

  let energyCost  = 0;
  let networkCost = 0;

  for (let i=0; i<8760; i++) {
    const draw_kwh = gridDraw[i] / 1000;
    if (draw_kwh <= 0) continue;
    const h = i % 24;

    // ── Energiekosten + Netzkosten korrekt trennen ──────────────────────────
    // Für die Aufschlüsselung (Balkendiagramm) wird energyCost als reiner
    // Beschaffungs-/Markup-Anteil und networkCost als Netzentgelt-Anteil geführt.
    let energy_ct: number;
    let network_ct: number;

    if (isDynamic) {
      // Dynamischer Tarif: Spot + Basisverbrauchspreis + Steuern/Abgaben (excl. Netzentgelt)
      energy_ct  = spotArr[i] + tariffData.dynamicTariff.spotMarkup_ct_per_kwh
                              + tariffData.dynamicTariff.taxes_and_levies_ct_per_kwh;
      // Netzentgelt-Arbeitspreis separat (ggf. Modul-reduziert)
      network_ct = getNetworkTariffOnly_ct(h, module14a);
    } else if (isTwoRate) {
      // HT/NT-Tarif: All-In-Preis aufgeteilt in Energie + Netzanteil
      const ntHours: number[] = tariffData.twoRateTariff.ntHours || [22, 23, 0, 1, 2, 3, 4, 5];
      const allIn_ct = ntHours.includes(h)
        ? tariffData.twoRateTariff.workingPriceNT_ct_per_kwh
        : tariffData.twoRateTariff.workingPriceHT_ct_per_kwh;
      network_ct = tariffData.networkCosts.total_ct_per_kwh;
      energy_ct  = allIn_ct - network_ct;
    } else {
      // Statischer Tarif: All-In-Preis aufgeteilt in Energie + (ggf. Modul-angepasstes) Netzentgelt
      // Modul 1: kein Per-Unit-Rabatt → Netzanteil = Basis; nur Jahrespauschalrabatt (annualDiscount)
      // Modul 2/3: Netzentgelt-Arbeitspreis wird durch Modulrate ersetzt
      network_ct = getNetworkCost_ct(h, isModuled ? module14a : 'none');
      energy_ct  = tariffData.staticTariff.workingPrice_ct_per_kwh - tariffData.networkCosts.total_ct_per_kwh;
    }

    energyCost  += draw_kwh * energy_ct  / 100;
    networkCost += draw_kwh * network_ct / 100;
  }

  // Einspeisevergütung
  const totalFeed_kwh = gridFeed.reduce((a,b)=>a+b,0) / 1000;
  const feedRate   = peakpower_kwp <= 10
    ? tariffData.feedInTariff.below10kwp_ct_per_kwh
    : tariffData.feedInTariff['10to40kwp_ct_per_kwh'];
  const feedInRevenue = totalFeed_kwh * feedRate / 100;

  // Grundpreis + Zählerkosten
  const basePrice  = isDynamic
    ? tariffData.dynamicTariff.basePrice_eur_per_year
    : isTwoRate
      ? tariffData.twoRateTariff.basePrice_eur_per_year
      : tariffData.staticTariff.basePrice_eur_per_year;
  const meterCost  = isModuled || isDynamic
    ? tariffData.meterCosts.iMSys_module14a_eur_per_year
    : tariffData.meterCosts.standard_eur_per_year;

  const annualDiscount = isModuled
    ? (tariffData.module14a[module14a]?.annualNetDiscount_eur_per_year || 0)
    : 0;

  const annualCost = energyCost + networkCost + basePrice + meterCost - annualDiscount;
  const netCost    = annualCost - feedInRevenue;

  const totalSelf_kwh  = selfCons.reduce((a,b)=>a+b,0) / 1000;
  const totalDraw_kwh  = gridDraw.reduce((a,b)=>a+b,0) / 1000;

  return {
    name, label,
    tariffType,
    module14a,
    annualCost_eur: Math.round(annualCost * 100) / 100,
    energyCost_eur: Math.round(energyCost * 100) / 100,
    networkCost_eur: Math.round((networkCost + basePrice) * 100) / 100,
    meterCost_eur: Math.round(meterCost * 100) / 100,
    feedInRevenue_eur: Math.round(feedInRevenue * 100) / 100,
    netCost_eur: Math.round(netCost * 100) / 100,
    selfConsumptionRate_pct: Math.min(100, Math.max(0, Math.round((totalSelf_kwh / Math.max(totalConsumption_kwh, 0.001)) * 1000) / 10)),
    autarkyRate_pct: Math.min(100, Math.max(0, Math.round((1 - totalDraw_kwh / Math.max(totalConsumption_kwh, 0.001)) * 1000) / 10)),
    recommended: false
  };
}

// ── Monatliche Energiebilanz ──────────────────────────────────────────────────
function buildMonthly(pvH: number[], consH: number[], drawH: number[], feedH: number[], selfH: number[]): MonthlyEnergy[] {
  const monthly: MonthlyEnergy[] = [];
  let idx = 0;
  for (let m=0; m<12; m++) {
    const hours = DAYS_PER_MONTH[m] * 24;
    let pv=0, cons=0, sc=0, feed=0, draw=0;
    for (let i=0; i<hours; i++,idx++) {
      pv   += pvH[idx]/1000;
      cons += consH[idx]/1000;
      sc   += selfH[idx]/1000;
      feed += feedH[idx]/1000;
      draw += drawH[idx]/1000;
    }
    monthly.push({
      month: MONTH_NAMES[m],
      pv_kwh:              Math.round(pv   * 10)/10,
      consumption_kwh:     Math.round(cons * 10)/10,
      selfConsumption_kwh: Math.round(sc   * 10)/10,
      gridFeed_kwh:        Math.round(feed * 10)/10,
      gridDraw_kwh:        Math.round(draw * 10)/10
    });
  }
  return monthly;
}

function buildScenarioResults(tariffs: TariffResult[]): ScenarioResult[] {
  const scenarios = [
    { name: 'Niedrig', label: 'Niedrige Marktpreise (-10 %)', factor: 0.9 },
    { name: 'Erhöht', label: 'Erhöhte Marktpreise (+10 %)', factor: 1.1 },
    { name: 'Hoch', label: 'Hohe Marktpreise (+25 %)', factor: 1.25 }
  ];

  const staticTariff = tariffs.find((t) => t.name === tariffData.staticTariff.name) ?? tariffs[0];

  return scenarios.map((scenario) => {
    const adjusted = tariffs.map((t) => {
      // Preisentwicklung wirkt primär auf den energiebezogenen Anteil.
      const deltaEnergy = t.energyCost_eur * (scenario.factor - 1);
      const adjustedNet = t.netCost_eur + deltaEnergy;
      return { label: t.label, adjustedNet };
    });

    adjusted.sort((a, b) => a.adjustedNet - b.adjustedNet);
    const best = adjusted[0];

    const staticAdjusted = staticTariff.netCost_eur + (staticTariff.energyCost_eur * (scenario.factor - 1));
    const savingVsStatic = staticAdjusted - best.adjustedNet;

    return {
      name: scenario.name,
      label: scenario.label,
      priceFactor: scenario.factor,
      recommendedTariff: best.label,
      recommendedNetCost_eur: Math.round(best.adjustedNet * 100) / 100,
      staticAdjustedNetCost_eur: Math.round(staticAdjusted * 100) / 100,
      savingVsStatic_eur: Math.round(savingVsStatic * 100) / 100
    };
  });
}

function applyBiDiShift(gridDraw: number[], spotArr: number[], annualShift_kwh: number): { shiftedDraw: number[]; shifted_kwh: number } {
  const shiftedDraw = [...gridDraw];
  let remainingWh = Math.max(0, annualShift_kwh * 1000);

  // Priorisiere teure Stunden für Entladung.
  const idxs = shiftedDraw
    .map((val, idx) => ({ idx, val, spot: spotArr[idx] }))
    .filter((x) => x.val > 0)
    .sort((a, b) => b.spot - a.spot);

  for (const it of idxs) {
    if (remainingWh <= 0) break;
    const reduce = Math.min(it.val, remainingWh);
    shiftedDraw[it.idx] -= reduce;
    remainingWh -= reduce;
  }

  const shifted_kwh = (annualShift_kwh * 1000 - remainingWh) / 1000;
  return { shiftedDraw, shifted_kwh: Math.round(shifted_kwh * 10) / 10 };
}

// ── Hauptfunktion ─────────────────────────────────────────────────────────────
export async function runCalculation(req: CalculationRequest): Promise<CalculationResponse> {
  const { lat, lon } = getCoordsFromPlz(req.household.plz);
  const buildingType = req.household.buildingType ?? 'EFH';

  // Parameter mit Defaults
  const peakpower = req.pv.hasPv ? (req.pv.peakpower_kwp ?? 5) : 0;
  const angle     = req.pv.angle_deg   ?? 30;
  const aspect    = req.pv.aspect_deg  ?? 0;   // 0 = Süd
  const loss      = req.pv.loss_pct    ?? 14;

  const storageCap    = req.storage.hasStorage ? (req.storage.capacity_kwh ?? 5) : 0;
  const storageMaxP   = req.storage.hasStorage ? (req.storage.maxPower_kw ?? 3) : 0;
  const storageEff    = req.storage.efficiency ?? 0.92;
  const dynamicOpt    = req.storage.useDynamicOptimization ?? false;
  const evVehicles    = getEVVehicles(req);
  const bidiEnabled   = evVehicles.some((vehicle) => vehicle.useBidirectional);

  // ── PV-Stundenprofil: live von PVGIS (standortgenau) oder Fallback ───────────
  let pvHourly: number[];
  let pvSource: 'pvgis-live' | 'fallback-static';

  if (peakpower > 0) {
    try {
      const pvData = await fetchPvData({ lat, lon, peakpower, angle, aspect, loss });
      // PVGIS gibt P in W zurück; pro Stunde = Wh
      let pvArr = pvData.map((d) => Math.max(0, d.P));
      // 2020 ist ein Schaltjahr (8784 h): Feb-29 entfernen (Stunden 1416–1439)
      if (pvArr.length === 8784) {
        pvArr = [...pvArr.slice(0, 1416), ...pvArr.slice(1440)];
      }
      // Sicherheitscheck: 8760 h erwartet
      if (pvArr.length !== 8760) {
        throw new Error(`PVGIS lieferte ${pvArr.length} Stunden statt 8760.`)
      }
      pvHourly  = pvArr;
      pvSource  = 'pvgis-live';
    } catch {
      // Fallback: internes Sachsen-Profil mit Korrekturfaktoren
      pvHourly = generatePvHourly(peakpower, angle, aspect, loss);
      pvSource = 'fallback-static';
    }
  } else {
    pvHourly = new Array(8760).fill(0);
    pvSource = 'fallback-static';
  }
  const consHourly = generateConsumptionHourly(req);
  const spotLive   = await buildSpotArrayLiveOrFallback();
  const spotArr    = spotLive.spotArrCt;

  // Speichersimulation
  let gridDraw: number[], gridFeed: number[], selfCons: number[];
  if (req.storage.hasStorage && storageCap > 0) {
    ({ gridDraw, gridFeed, selfCons } = simulateStorage(pvHourly, consHourly, storageCap, storageMaxP, storageEff, spotArr, dynamicOpt, spotLive.annualAvgCt));
  } else {
    gridDraw = []; gridFeed = []; selfCons = [];
    for (let i=0; i<8760; i++) {
      const pv   = pvHourly[i];
      const cons = consHourly[i];
      const ex   = pv - cons;
      gridFeed.push(Math.max(0,  ex));
      gridDraw.push(Math.max(0, -ex));
      selfCons.push(Math.min(pv, cons));
    }
  }

  let bidiShifted_kwh = 0;
  if (bidiEnabled) {
    const evAnnual_kwh = evVehicles
      .filter((vehicle) => vehicle.useBidirectional)
      .reduce((sum, vehicle) => {
        const evKm = vehicle.annualKm ?? 12000;
        const evCons = vehicle.consumption_kwh_per_100km ?? 20;
        return sum + ((evKm / 100) * evCons);
      }, 0);
    // Platzhalter: max. 12% des Jahres-EV-Bedarfs kann netzdienlich/haushaltsseitig rückgespeist werden.
    const potentialShift_kwh = evAnnual_kwh * 0.12;
    const shifted = applyBiDiShift(gridDraw, spotArr, potentialShift_kwh);
    gridDraw = shifted.shiftedDraw;
    bidiShifted_kwh = shifted.shifted_kwh;
  }

  const totalCons_kwh  = consHourly.reduce((a,b)=>a+b,0)/1000;
  const totalPv_kwh    = pvHourly.reduce((a,b)=>a+b,0)/1000;
  const totalFeed_kwh  = gridFeed.reduce((a,b)=>a+b,0)/1000;
  const totalDraw_kwh  = gridDraw.reduce((a,b)=>a+b,0)/1000;
  const totalSelf_kwh  = selfCons.reduce((a,b)=>a+b,0)/1000;

  // Tarife berechnen
  const tariffs: TariffResult[] = [];
  const largeLoads = getLargeLoads(req);
  const largeLoadCount = largeLoads.length;
  const largeLoadPowerKw = largeLoads.reduce((max, load) => Math.max(max, load.powerKw ?? 0), 0);
  const largeLoadDailyCurveKw = buildLargeLoadDailyCurveKw(largeLoads).map((value) => Math.round(value * 100) / 100);
  const canUse14a = largeLoads.some((load) => (load.powerKw ?? 0) >= 4.2) || req.tariff.largeLoadOver42kw === true;
  const candidateModules: TarifModul14a[] = canUse14a ? ['none', 'modul1', 'modul2', 'modul3'] : ['none'];
  const candidateTariffs: Array<'static' | 'twoRate' | 'dynamic'> = ['static', 'twoRate', 'dynamic'];

  for (const tariffType of candidateTariffs) {
    for (const module14a of candidateModules) {
      tariffs.push(calcTariffCost(
        gridDraw,
        gridFeed,
        selfCons,
        spotArr,
        getCombinedTariffLabel(tariffType, module14a),
        `${tariffType}-${module14a}`,
        tariffType,
        module14a,
        peakpower,
        totalCons_kwh
      ));
    }
  }

  const staticResult = tariffs.find((tariff) => tariff.tariffType === 'static' && tariff.module14a === 'none') || tariffs[0];

  // Empfehlung: günstigster NetCost
  const sorted   = [...tariffs].sort((a,b)=>a.netCost_eur - b.netCost_eur);
  const best     = sorted[0];
  best.recommended = true;
  const saving   = staticResult.netCost_eur - best.netCost_eur;
  const recommendedTariff = getTariffLabel(best.tariffType);
  const recommendedModuleLabel = getModuleLabel(best.module14a);
  // Uncertainty band: for negative net cost (large PV feed-in revenue), invert factors so
  // bestCase = most negative (most gain) and worstCase = least negative (least gain).
  const netC = best.netCost_eur;
  const uncertaintyBand = netC >= 0
    ? {
        bestCase:  Math.round(netC * 0.88 * 100) / 100,
        expected:  Math.round(netC         * 100) / 100,
        worstCase: Math.round(netC * 1.18 * 100) / 100
      }
    : {
        bestCase:  Math.round(netC * 1.18 * 100) / 100,
        expected:  Math.round(netC        * 100) / 100,
        worstCase: Math.round(netC * 0.88 * 100) / 100
      };

  const monthly  = buildMonthly(pvHourly, consHourly, gridDraw, gridFeed, selfCons);
  const scenarios = buildScenarioResults(tariffs);
  const dynamicMarkupCt = Number(tariffData.dynamicTariff.spotMarkup_ct_per_kwh || 0);
  const dynamicTaxesCt = Number(tariffData.dynamicTariff.taxes_and_levies_ct_per_kwh || 0);
  const dynamicMarkupPlusTaxesCt = dynamicMarkupCt + dynamicTaxesCt;
  const dynamicTariffPriceHourlyCt = spotLive.hourlyAvgCt.map((spotCt) => spotCt + dynamicMarkupPlusTaxesCt);

  return {
    success: true,
    data: {
      monthly,
      tariffs,
      scenarios,
      spotPrices_ct_per_kwh: spotLive.hourlyAvgCt,
      dynamicTariffPrice_ct_per_kwh: dynamicTariffPriceHourlyCt,
      dynamicTariffComponents_ct_per_kwh: {
        spot_markup: dynamicMarkupCt,
        taxes_and_levies: dynamicTaxesCt,
        markup_plus_taxes: dynamicMarkupPlusTaxesCt
      },
      dataTransparency: [
        {
          category: 'PV-Erzeugung',
          status: pvSource === 'pvgis-live' ? 'measured' : 'modeled',
          source: pvSource === 'pvgis-live'
            ? `PVGIS API (EU JRC) – Standort ${lat.toFixed(2)}°N / ${lon.toFixed(2)}°E, ${angle}° Neigung, Ausrichtung ${aspect}°, Verluste ${loss}%`
            : 'Fallback: internes Sachsen-Profil + Korrekturfaktoren (PVGIS-Referenz)',
          note: pvSource === 'pvgis-live'
            ? 'Stundenwerte direkt von PVGIS (TMY 2023) für exakte PLZ-Koordinaten berechnet.'
            : 'PVGIS-API nicht erreichbar – Fallback auf regionalisiertes Sachsen-Modellprofil.'
        },
        {
          category: 'Spotpreise (dynamischer Tarif)',
          status: spotLive.source === 'live-awattar' ? 'measured' : 'modeled',
          source: spotLive.source === 'live-awattar'
            ? 'aWATTar API (EPEX Day-Ahead, stündliche Live-Werte je Uhrzeit)'
            : 'Fallback: internes Spotprofil 2025 (Monatsmittel + Tagesfaktoren)',
          note: spotLive.source === 'live-awattar'
            ? 'Dynamischer Tarif wird stündlich anhand der Live-Marktdaten aktualisiert.'
            : 'Live-API nicht erreichbar, daher automatische Ersatzberechnung mit internem Profil.'
        },
        {
          category: 'Tarifdaten SachsenEnergie',
          status: 'official',
          source: 'Öffentliche Tarifinformationen 2025 + angenäherte Kostenparameter',
          note: 'Für konkrete Angebote bitte finale Produktblätter/PLZ-spezifische Preise prüfen.'
        },
        {
          category: '§14a Module 1-3',
          status: 'official',
          source: 'BNetzA/BNetz-Rahmen + modellierte Wirkung in Kostenlogik',
          note: 'Reale Netzbetreiber-Umsetzung kann lokal abweichen.'
        },
        {
          category: 'Haushaltslast/WP/EV',
          status: 'modeled',
          source: 'BDEW-nahe Standardprofile und Referenzannahmen',
          note: 'Ohne Messdaten werden typische Lastgänge verwendet.'
        }
      ],
      summary: {
        pvYield_kwh:         Math.round(totalPv_kwh  * 10)/10,
        totalConsumption_kwh: Math.round(totalCons_kwh * 10)/10,
        selfConsumption_kwh:  Math.round(totalSelf_kwh  * 10)/10,
        gridFeed_kwh:         Math.round(totalFeed_kwh  * 10)/10,
        gridDraw_kwh:         Math.round(totalDraw_kwh  * 10)/10,
        recommendation:       best.name,
        recommendedTariff,
        recommendedModule: best.module14a,
        recommendedModuleLabel,
        annualSavingVsStatic_eur: Math.round(saving * 100)/100,
        uncertaintyBand_eur: uncertaintyBand
      },
      usedParams: {
        peakpower_kwp: peakpower,
        angle_deg:     angle,
        aspect_deg:    aspect,
        coordinates:   { lat, lon },
        pvSource,
        persons:       req.household.persons,
        buildingType,
        storage_kwh:   storageCap,
        largeLoadCount,
        largeLoadPowerKw,
        largeLoadOver42kw: canUse14a,
        largeLoadDailyCurveKw
        ,bidiEnabled
        ,bidiShifted_kwh
      }
    }
  };
}
