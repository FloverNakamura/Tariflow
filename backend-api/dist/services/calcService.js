"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCalculation = runCalculation;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const geocodeService_1 = require("./geocodeService");
const pvService_1 = require("./pvService");
const dynamicTarifEligibility_1 = require("./dynamicTarifEligibility");
const HOURS_PER_YEAR = 365 * 24;
const YEAR = 2025;
let loadProfilesCache = null;
let spotPriceCache = null;
let tariffDataCache = null;
function readJson(relativePath) {
    const filePath = path.join(__dirname, relativePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
}
function getLoadProfiles() {
    if (!loadProfilesCache) {
        loadProfilesCache = readJson('../data/loadProfiles.json');
    }
    return loadProfilesCache;
}
function getSpotData() {
    if (!spotPriceCache) {
        spotPriceCache = readJson('../data/spotPrices2025.json');
    }
    return spotPriceCache;
}
function getTariffData() {
    if (!tariffDataCache) {
        tariffDataCache = readJson('../data/tariffData.json');
    }
    return tariffDataCache;
}
function sum(values) {
    return values.reduce((acc, value) => acc + value, 0);
}
function round(value, digits = 2) {
    return Number(value.toFixed(digits));
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function normalize(values) {
    const total = sum(values);
    if (total <= 0) {
        return values.map(() => 0);
    }
    return values.map((value) => value / total);
}
function createHoursTemplate() {
    return Array.from({ length: HOURS_PER_YEAR }, () => 0);
}
function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
}
function monthIndexByHour(hourIdx) {
    const date = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0));
    date.setUTCHours(date.getUTCHours() + hourIdx);
    return date.getUTCMonth();
}
function buildBaseHouseholdAnnualConsumption(persons, buildingType) {
    const profiles = getLoadProfiles();
    const key = String(clamp(Math.round(persons), 1, 6));
    const base = profiles.annualBaseByPersons_kwh[key] ?? profiles.annualBaseByPersons_kwh['2'] ?? 3000;
    const multiplier = profiles.buildingTypeMultiplier[buildingType] ?? 1;
    return base * multiplier;
}
function buildGeneralLoadProfile(annualKwh) {
    const profiles = getLoadProfiles();
    const monthFactors = normalize(profiles.monthFactors || []);
    const weekdayHourFactors = normalize(profiles.weekdayHourFactors || []);
    const weekendHourFactors = normalize(profiles.weekendHourFactors || []);
    const raw = createHoursTemplate();
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        const date = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0));
        date.setUTCHours(date.getUTCHours() + h);
        const month = date.getUTCMonth();
        const hour = date.getUTCHours();
        const monthWeight = monthFactors[month] || 0;
        const hourWeight = isWeekend(date)
            ? (weekendHourFactors[hour] || 0)
            : (weekdayHourFactors[hour] || 0);
        raw[h] = monthWeight * hourWeight;
    }
    const normalized = normalize(raw);
    return normalized.map((weight) => annualKwh * weight);
}
function buildHeatPumpProfile(annualKwh, cop) {
    const profiles = getLoadProfiles();
    const monthFactors = normalize(profiles.heatPump?.monthFactors || []);
    const hourFactors = normalize(profiles.heatPump?.hourFactors || []);
    const raw = createHoursTemplate();
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        const date = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0));
        date.setUTCHours(date.getUTCHours() + h);
        raw[h] = (monthFactors[date.getUTCMonth()] || 0) * (hourFactors[date.getUTCHours()] || 0);
    }
    const normalized = normalize(raw);
    const basePower = normalized.map((weight) => annualKwh * weight);
    // Integriere COP (Coefficient of Performance) für Effizienzberechnung
    // COP = 3.0 bedeutet: 3 kWh Wärmeleistung pro 1 kWh Strom
    const effectiveCop = Math.max(2.5, Math.min(cop || 3.5, 5.0)); // Bereiche 2.5-5.0
    const copFactor = effectiveCop / 3.5; // Normalisierung auf Standard-COP
    // Höherer COP = bessere Effizienz = geringerer Stromverbrauch
    return basePower.map((power) => power / copFactor);
}
function buildEvProfile(annualKwh, preferNightCharging, wallboxPower_kw, batteryCapacity_kwh) {
    const profiles = getLoadProfiles();
    const shape = preferNightCharging
        ? profiles.ev?.nightHourFactors || []
        : profiles.ev?.eveningHourFactors || [];
    const hourFactors = normalize(shape);
    const monthlySeasonality = normalize([1.08, 1.05, 1.02, 1, 0.98, 0.96, 0.95, 0.95, 0.98, 1, 1.01, 1.02]);
    const raw = createHoursTemplate();
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        const date = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0));
        date.setUTCHours(date.getUTCHours() + h);
        raw[h] = (hourFactors[date.getUTCHours()] || 0) * (monthlySeasonality[date.getUTCMonth()] || 0);
    }
    const normalized = normalize(raw);
    const profile = normalized.map((weight) => annualKwh * weight);
    // Integriere Wallbox-Leistung: limitiere Spitzenlast
    const maxWallboxPower = Math.max(0.1, wallboxPower_kw || 11); // Default 11 kW
    const batteryBuffer = Math.max(0.1, batteryCapacity_kwh || 60); // Default 60 kWh
    for (let h = 0; h < profile.length; h++) {
        // Limitiere Peak auf Wallbox-Leistung, aber erlaube Burst für größere Batterien
        const peakLimit = maxWallboxPower * (1 + Math.min(batteryBuffer / 100, 0.3)); // bis +30% Peak-Boost
        profile[h] = Math.min(profile[h], peakLimit);
    }
    return profile;
}
function buildLargeLoadProfile(annualKwh, curveKw) {
    const hourlyCurve = Array.isArray(curveKw) && curveKw.length === 24
        ? curveKw
        : Array.from({ length: 24 }, () => 0);
    const dayEnergy = sum(hourlyCurve);
    if (annualKwh <= 0 || dayEnergy <= 0) {
        return createHoursTemplate();
    }
    // Integriere die tatsächliche 24h-Kurve direkt (nicht aggregiert!)
    const dayShape = normalize(hourlyCurve.map((value) => Math.max(0, value)));
    const monthly = normalize([1.04, 1.03, 1.01, 0.98, 0.97, 0.95, 0.94, 0.95, 0.99, 1.01, 1.02, 1.02]);
    const raw = createHoursTemplate();
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        const date = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0));
        date.setUTCHours(date.getUTCHours() + h);
        const dayOfYear = Math.floor(h / 24);
        const hourOfDay = date.getUTCHours();
        const month = date.getUTCMonth();
        // Nutze spezifische Stundenkurve mit Saisonalität
        const hourShape = dayShape[hourOfDay] || 0;
        const seasonalFactor = monthly[month] || 0;
        raw[h] = hourShape * seasonalFactor;
    }
    const normalized = normalize(raw);
    return normalized.map((weight) => annualKwh * weight);
}
function buildSpotSeries() {
    const data = getSpotData();
    const output = createHoursTemplate();
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        const date = new Date(Date.UTC(YEAR, 0, 1, 0, 0, 0));
        date.setUTCHours(date.getUTCHours() + h);
        const month = date.getUTCMonth();
        const hour = date.getUTCHours();
        const dayOfYear = Math.floor(h / 24);
        const weekend = isWeekend(date);
        const base = data.monthlyBaseCt[month] || 8;
        const intraday = data.hourlyAddCt[hour] || 0;
        const weekdayAdj = weekend ? data.weekendDiscountCt : data.weekdayPremiumCt;
        const volatility = data.monthlyVolatilityCt[month] || 1.2;
        const pseudoRandom = Math.sin((dayOfYear + 1) * 0.91 + hour * 0.47 + month * 0.33) * volatility;
        const value = base + intraday + weekdayAdj + pseudoRandom;
        output[h] = clamp(value, -3, 50);
    }
    return output;
}
function percentile(values, p) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = clamp(Math.floor((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
    return sorted[idx];
}
function simulateStorageAndFlows(load, pv, storage, spotPrices) {
    const gridDraw = createHoursTemplate();
    const gridFeed = createHoursTemplate();
    const selfConsumption = createHoursTemplate();
    const directConsumption = createHoursTemplate();
    if (!storage.hasStorage || (storage.capacity_kwh || 0) <= 0 || (storage.maxPower_kw || 0) <= 0) {
        for (let h = 0; h < HOURS_PER_YEAR; h++) {
            const direct = Math.min(load[h] || 0, pv[h] || 0);
            const demandAfterDirect = Math.max(0, (load[h] || 0) - direct);
            const surplus = Math.max(0, (pv[h] || 0) - direct);
            directConsumption[h] = direct;
            selfConsumption[h] = direct;
            gridDraw[h] = demandAfterDirect;
            gridFeed[h] = surplus;
        }
        return { gridDraw, gridFeed, selfConsumption, directConsumption };
    }
    const capacity = Math.max(0.1, storage.capacity_kwh || 0);
    const maxPower = Math.max(0.1, storage.maxPower_kw || 0);
    const roundTrip = clamp(storage.efficiency || 0.92, 0.5, 1);
    const etaCharge = Math.sqrt(roundTrip);
    const etaDischarge = Math.sqrt(roundTrip);
    const dynamic = Boolean(storage.useDynamicOptimization);
    const cheapThreshold = percentile(spotPrices, 35);
    const expensiveThreshold = percentile(spotPrices, 70);
    let soc = capacity * 0.25;
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        const demand = Math.max(0, load[h] || 0);
        const pvGen = Math.max(0, pv[h] || 0);
        let direct = Math.min(demand, pvGen);
        let remainingDemand = demand - direct;
        let pvSurplus = pvGen - direct;
        let hourGridDraw = 0;
        const chargeFromPv = Math.min(pvSurplus, maxPower, Math.max(0, (capacity - soc) / etaCharge));
        soc += chargeFromPv * etaCharge;
        pvSurplus -= chargeFromPv;
        const isCheap = (spotPrices[h] || 0) <= cheapThreshold;
        if (dynamic && isCheap) {
            const extraGridCharge = Math.min(maxPower - chargeFromPv, Math.max(0, (capacity * 0.92 - soc) / etaCharge));
            if (extraGridCharge > 0) {
                soc += extraGridCharge * etaCharge;
                hourGridDraw += extraGridCharge;
            }
        }
        const isExpensive = (spotPrices[h] || 0) >= expensiveThreshold;
        const allowDischarge = !dynamic || isExpensive || remainingDemand > maxPower * 0.22;
        let batteryToLoad = 0;
        if (allowDischarge && remainingDemand > 0 && soc > 0) {
            batteryToLoad = Math.min(remainingDemand, maxPower, soc * etaDischarge);
            soc -= batteryToLoad / etaDischarge;
            remainingDemand -= batteryToLoad;
        }
        hourGridDraw += remainingDemand;
        gridDraw[h] = Math.max(0, hourGridDraw);
        gridFeed[h] = Math.max(0, pvSurplus);
        directConsumption[h] = direct;
        selfConsumption[h] = Math.max(0, direct + batteryToLoad);
    }
    return { gridDraw, gridFeed, selfConsumption, directConsumption };
}
function applyBidirectionalShift(gridDrawInput, spotPrices, enabled, annualEvConsumptionKwh) {
    if (!enabled || annualEvConsumptionKwh <= 0) {
        return { gridDraw: [...gridDrawInput], shiftedKwh: 0 };
    }
    const gridDraw = [...gridDrawInput];
    const totalGrid = sum(gridDraw);
    const shiftBudget = Math.min(totalGrid * 0.12, annualEvConsumptionKwh * 0.4);
    const expensiveHours = Array.from({ length: HOURS_PER_YEAR }, (_, idx) => idx)
        .filter((idx) => gridDraw[idx] > 0.01)
        .sort((a, b) => (spotPrices[b] || 0) - (spotPrices[a] || 0));
    const cheapHours = Array.from({ length: HOURS_PER_YEAR }, (_, idx) => idx)
        .sort((a, b) => (spotPrices[a] || 0) - (spotPrices[b] || 0));
    const addCap = createHoursTemplate().map(() => 1.8);
    let shifted = 0;
    let cheapPointer = 0;
    for (const expIdx of expensiveHours) {
        if (shifted >= shiftBudget) {
            break;
        }
        let removable = Math.min(gridDraw[expIdx] * 0.65, shiftBudget - shifted);
        while (removable > 0.0001 && cheapPointer < cheapHours.length) {
            const cheapIdx = cheapHours[cheapPointer];
            const room = Math.max(0, addCap[cheapIdx]);
            if (room <= 0.0001) {
                cheapPointer++;
                continue;
            }
            const transfer = Math.min(removable, room);
            gridDraw[expIdx] -= transfer;
            gridDraw[cheapIdx] += transfer;
            addCap[cheapIdx] -= transfer;
            shifted += transfer;
            removable -= transfer;
            if (addCap[cheapIdx] <= 0.0001) {
                cheapPointer++;
            }
            if (shifted >= shiftBudget) {
                break;
            }
        }
    }
    for (let i = 0; i < gridDraw.length; i++) {
        gridDraw[i] = Math.max(0, gridDraw[i]);
    }
    return { gridDraw, shiftedKwh: shifted };
}
function isHourInWindow(hour, startHour, endHour) {
    if (startHour === endHour)
        return true;
    if (startHour < endHour)
        return hour >= startHour && hour < endHour;
    return hour >= startHour || hour < endHour;
}
function calculateModuleDiscountEur(moduleKey, networkCtPerKwh, gridDraw) {
    const tariffData = getTariffData();
    const module = tariffData.modules14a[moduleKey];
    if (!module || module.type === 'none')
        return 0;
    let discountEur = Number(module.annual_discount_eur || 0);
    if ((module.type === 'network_time_window_discount' || module.type === 'hybrid') && module.windows?.length) {
        const perKwhDiscountCt = Number(module.discount_ct_per_kwh || 0);
        for (let h = 0; h < HOURS_PER_YEAR; h++) {
            const hour = h % 24;
            const inWindow = module.windows.some((window) => isHourInWindow(hour, window.startHour, window.endHour));
            if (!inWindow)
                continue;
            const applicableCt = Math.min(perKwhDiscountCt, networkCtPerKwh[h] || 0);
            discountEur += (gridDraw[h] || 0) * applicableCt / 100;
        }
    }
    return discountEur;
}
function createMonthlySummary(consumption, pv, selfConsumption, gridFeed, gridDraw) {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthly = Array.from({ length: 12 }, (_, index) => ({
        month: names[index],
        pv_kwh: 0,
        consumption_kwh: 0,
        selfConsumption_kwh: 0,
        gridFeed_kwh: 0,
        gridDraw_kwh: 0,
    }));
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        const month = monthIndexByHour(h);
        monthly[month].pv_kwh += pv[h] || 0;
        monthly[month].consumption_kwh += consumption[h] || 0;
        monthly[month].selfConsumption_kwh += selfConsumption[h] || 0;
        monthly[month].gridFeed_kwh += gridFeed[h] || 0;
        monthly[month].gridDraw_kwh += gridDraw[h] || 0;
    }
    return monthly.map((entry) => ({
        ...entry,
        pv_kwh: round(entry.pv_kwh),
        consumption_kwh: round(entry.consumption_kwh),
        selfConsumption_kwh: round(entry.selfConsumption_kwh),
        gridFeed_kwh: round(entry.gridFeed_kwh),
        gridDraw_kwh: round(entry.gridDraw_kwh),
    }));
}
function computeSelfAndAutarky(totalSelf, totalConsumption) {
    const ratio = totalConsumption > 0 ? totalSelf / totalConsumption : 0;
    const pctValue = round(ratio * 100);
    return { selfRate: pctValue, autarky: pctValue };
}
function getAllowedModules(request) {
    const flexibilityExists = request.heatPump.use14aModule ||
        request.tariff.largeLoadOver42kw ||
        request.emobility.hasEV;
    return flexibilityExists
        ? ['none', 'modul1', 'modul2', 'modul3']
        : ['none'];
}
function evaluateTariffs(request, gridDraw, gridFeed, selfConsumptionRatePct, autarkyRatePct, spotPricesCtPerKwh) {
    const tariffData = getTariffData();
    const feedInCt = (request.pv.peakpower_kwp || 0) > 10
        ? Number(tariffData.feedIn.largeSystemOver10kWp_ct_per_kwh || tariffData.feedIn.default_ct_per_kwh)
        : Number(tariffData.feedIn.smallSystemUpTo10kWp_ct_per_kwh || tariffData.feedIn.default_ct_per_kwh);
    const totalFeed = sum(gridFeed);
    const moduleKeys = getAllowedModules(request);
    const results = [];
    for (const tariff of tariffData.staticTariffs || []) {
        for (const moduleKey of moduleKeys) {
            const energyCost = sum(gridDraw) * tariff.energy_ct_per_kwh / 100;
            const networkByHour = gridDraw.map(() => tariff.network_ct_per_kwh);
            const networkBeforeDiscount = sum(gridDraw) * tariff.network_ct_per_kwh / 100;
            const moduleDiscount = calculateModuleDiscountEur(moduleKey, networkByHour, gridDraw);
            const networkCost = Math.max(0, networkBeforeDiscount - moduleDiscount);
            const annualCost = energyCost + networkCost + tariff.base_eur_per_year + tariff.meter_eur_per_year;
            const feedInRevenue = totalFeed * feedInCt / 100;
            const netCost = annualCost - feedInRevenue;
            results.push({
                name: `${tariff.name}_${moduleKey}`,
                label: `${tariff.label} (${moduleKey})`,
                tariffType: 'static',
                module14a: moduleKey,
                annualCost_eur: round(annualCost),
                energyCost_eur: round(energyCost),
                networkCost_eur: round(networkCost),
                meterCost_eur: round(tariff.meter_eur_per_year),
                feedInRevenue_eur: round(feedInRevenue),
                netCost_eur: round(netCost),
                selfConsumptionRate_pct: selfConsumptionRatePct,
                autarkyRate_pct: autarkyRatePct,
                recommended: false,
            });
        }
    }
    for (const tariff of tariffData.twoRateTariffs || []) {
        const htSet = new Set((tariff.ht_hours || []).map((hour) => Math.round(hour) % 24));
        for (const moduleKey of moduleKeys) {
            let energyCost = 0;
            let networkBeforeDiscount = 0;
            const networkByHour = createHoursTemplate();
            for (let h = 0; h < HOURS_PER_YEAR; h++) {
                const hour = h % 24;
                const isHt = htSet.has(hour);
                const energyCt = isHt ? tariff.energy_ht_ct_per_kwh : tariff.energy_nt_ct_per_kwh;
                const networkCt = isHt ? tariff.network_ht_ct_per_kwh : tariff.network_nt_ct_per_kwh;
                const draw = gridDraw[h] || 0;
                energyCost += draw * energyCt / 100;
                networkBeforeDiscount += draw * networkCt / 100;
                networkByHour[h] = networkCt;
            }
            const moduleDiscount = calculateModuleDiscountEur(moduleKey, networkByHour, gridDraw);
            const networkCost = Math.max(0, networkBeforeDiscount - moduleDiscount);
            const annualCost = energyCost + networkCost + tariff.base_eur_per_year + tariff.meter_eur_per_year;
            const feedInRevenue = totalFeed * feedInCt / 100;
            const netCost = annualCost - feedInRevenue;
            results.push({
                name: `${tariff.name}_${moduleKey}`,
                label: `${tariff.label} (${moduleKey})`,
                tariffType: 'twoRate',
                module14a: moduleKey,
                annualCost_eur: round(annualCost),
                energyCost_eur: round(energyCost),
                networkCost_eur: round(networkCost),
                meterCost_eur: round(tariff.meter_eur_per_year),
                feedInRevenue_eur: round(feedInRevenue),
                netCost_eur: round(netCost),
                selfConsumptionRate_pct: selfConsumptionRatePct,
                autarkyRate_pct: autarkyRatePct,
                recommended: false,
            });
        }
    }
    const dynamic = tariffData.dynamicTariff;
    const allowedDynamicModules = (dynamic.allowedModules && dynamic.allowedModules.length)
        ? dynamic.allowedModules
        : moduleKeys;
    for (const moduleKey of moduleKeys) {
        if (!allowedDynamicModules.includes(moduleKey)) {
            continue;
        }
        const dynamicEnergyCtSeries = spotPricesCtPerKwh.map((spotCt) => spotCt + dynamic.spotMarkup_ct_per_kwh + dynamic.taxes_and_levies_ct_per_kwh);
        let energyCost = 0;
        let networkBeforeDiscount = 0;
        const networkByHour = createHoursTemplate();
        for (let h = 0; h < HOURS_PER_YEAR; h++) {
            const draw = gridDraw[h] || 0;
            energyCost += draw * dynamicEnergyCtSeries[h] / 100;
            networkBeforeDiscount += draw * dynamic.network_ct_per_kwh / 100;
            networkByHour[h] = dynamic.network_ct_per_kwh;
        }
        const moduleDiscount = calculateModuleDiscountEur(moduleKey, networkByHour, gridDraw);
        const networkCost = Math.max(0, networkBeforeDiscount - moduleDiscount);
        const annualCost = energyCost + networkCost + dynamic.base_eur_per_year + dynamic.meter_eur_per_year;
        const feedInRevenue = totalFeed * feedInCt / 100;
        const netCost = annualCost - feedInRevenue;
        results.push({
            name: `${dynamic.name}_${moduleKey}`,
            label: `${dynamic.label} (${moduleKey})`,
            tariffType: 'dynamic',
            module14a: moduleKey,
            annualCost_eur: round(annualCost),
            energyCost_eur: round(energyCost),
            networkCost_eur: round(networkCost),
            meterCost_eur: round(dynamic.meter_eur_per_year),
            feedInRevenue_eur: round(feedInRevenue),
            netCost_eur: round(netCost),
            selfConsumptionRate_pct: selfConsumptionRatePct,
            autarkyRate_pct: autarkyRatePct,
            recommended: false,
        });
    }
    const sorted = [...results].sort((a, b) => a.netCost_eur - b.netCost_eur);
    const best = sorted[0];
    return results.map((result) => ({
        ...result,
        recommended: best ? result.name === best.name : false,
    }));
}
function buildScenarioResults(tariffs) {
    if (!tariffs.length) {
        return [];
    }
    const recommended = tariffs.find((tariff) => tariff.recommended) || tariffs[0];
    const bestStatic = tariffs
        .filter((tariff) => tariff.tariffType === 'static')
        .sort((a, b) => a.netCost_eur - b.netCost_eur)[0] || recommended;
    const factors = [0.85, 1.0, 1.15];
    const labels = ['Niedrigpreis', 'Erwartung', 'Hochpreis'];
    return factors.map((factor, index) => {
        const recAdjusted = recommended.tariffType === 'dynamic'
            ? (recommended.netCost_eur - recommended.energyCost_eur) + recommended.energyCost_eur * factor
            : recommended.netCost_eur * (1 + (factor - 1) * 0.22);
        const staticAdjusted = bestStatic.netCost_eur * (1 + (factor - 1) * 0.08);
        const saving = staticAdjusted - recAdjusted;
        return {
            name: `scenario_${index + 1}`,
            label: labels[index],
            priceFactor: factor,
            recommendedTariff: recommended.label,
            recommendedNetCost_eur: round(recAdjusted),
            staticAdjustedNetCost_eur: round(staticAdjusted),
            savingVsStatic_eur: round(saving),
        };
    });
}
async function runCalculation(request) {
    const household = request.household;
    const coords = (0, geocodeService_1.getCoordsFromPlz)(household.plz);
    const manualAnnualGiven = Number.isFinite(household.annualConsumption_kwh) && (household.annualConsumption_kwh || 0) > 0;
    const householdEstimatedAnnual = buildBaseHouseholdAnnualConsumption(household.persons, household.buildingType || 'EFH');
    const heatPumpAnnual = !manualAnnualGiven && request.heatPump.hasHeatPump
        ? Math.max(0, request.heatPump.annualConsumption_kwh || 0)
        : 0;
    const evAnnualFromVehicles = (request.emobility.vehicles || []).reduce((acc, vehicle) => {
        const annualKm = Number(vehicle.annualKm || 0);
        const consumption = Number(vehicle.consumption_kwh_per_100km || 0);
        return acc + annualKm * consumption / 100;
    }, 0);
    const evAnnualLegacy = (request.emobility.annualKm || 0) * (request.emobility.consumption_kwh_per_100km || 0) / 100;
    const evAnnual = !manualAnnualGiven && request.emobility.hasEV
        ? Math.max(0, evAnnualFromVehicles || evAnnualLegacy)
        : 0;
    const largeLoadDaily = (request.tariff.largeLoadDailyCurveKw || []).reduce((acc, value) => acc + Math.max(0, value), 0);
    const largeLoadAnnual = !manualAnnualGiven ? Math.max(0, largeLoadDaily * 365) : 0;
    const annualTarget = manualAnnualGiven
        ? Number(household.annualConsumption_kwh)
        : householdEstimatedAnnual + heatPumpAnnual + evAnnual + largeLoadAnnual;
    const baseLoad = buildGeneralLoadProfile(manualAnnualGiven ? annualTarget : householdEstimatedAnnual);
    const heatPumpLoad = manualAnnualGiven ? createHoursTemplate() : buildHeatPumpProfile(heatPumpAnnual, request.heatPump.cop);
    const evLoad = manualAnnualGiven ? createHoursTemplate() : buildEvProfile(evAnnual, request.emobility.preferNightCharging !== false, request.emobility.chargingPower_kw, (() => {
        // Ermittle Batterie-Kapazität aus Fahrzeugflotte oder Legacy
        if (request.emobility.vehicles?.length) {
            return (request.emobility.vehicles[0]?.batteryCapacity_kwh || 60);
        }
        return 60; // Default
    })());
    const largeLoad = manualAnnualGiven ? createHoursTemplate() : buildLargeLoadProfile(largeLoadAnnual, request.tariff.largeLoadDailyCurveKw || []);
    const totalLoad = createHoursTemplate();
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
        totalLoad[h] = (baseLoad[h] || 0) + (heatPumpLoad[h] || 0) + (evLoad[h] || 0) + (largeLoad[h] || 0);
    }
    let pvHourly = createHoursTemplate();
    let pvSource = 'fallback-static';
    if (request.pv.hasPv && (request.pv.peakpower_kwp || 0) > 0) {
        const pvRequest = {
            lat: coords.lat,
            lon: coords.lon,
            peakpower: request.pv.peakpower_kwp || 0,
            angle: request.pv.angle_deg,
            aspect: request.pv.aspect_deg,
            loss: request.pv.loss_pct,
        };
        const pvSeries = await (0, pvService_1.fetchPvDataWithSource)(pvRequest);
        pvSource = pvSeries.source;
        pvHourly = pvSeries.data
            .slice(0, HOURS_PER_YEAR)
            .map((entry) => Math.max(0, Number(entry.P || 0) / 1000));
        while (pvHourly.length < HOURS_PER_YEAR) {
            pvHourly.push(0);
        }
    }
    const spotPrices = buildSpotSeries();
    const storageResult = simulateStorageAndFlows(totalLoad, pvHourly, request.storage, spotPrices);
    const bidi = applyBidirectionalShift(storageResult.gridDraw, spotPrices, Boolean(request.emobility.useBidirectional), evAnnual);
    const finalGridDraw = bidi.gridDraw;
    const totalConsumption = sum(totalLoad);
    const totalPvYield = sum(pvHourly);
    const totalSelfConsumption = sum(storageResult.selfConsumption);
    const totalGridFeed = sum(storageResult.gridFeed);
    const totalGridDraw = sum(finalGridDraw);
    const rates = computeSelfAndAutarky(totalSelfConsumption, totalConsumption);
    const tariffs = evaluateTariffs(request, finalGridDraw, storageResult.gridFeed, rates.selfRate, rates.autarky, spotPrices).sort((a, b) => a.netCost_eur - b.netCost_eur);
    const recommended = tariffs.find((entry) => entry.recommended) || tariffs[0];
    const bestStatic = tariffs
        .filter((entry) => entry.tariffType === 'static')
        .sort((a, b) => a.netCost_eur - b.netCost_eur)[0] || recommended;
    const scenarios = buildScenarioResults(tariffs);
    const tariffData = getTariffData();
    const moduleLabel = tariffData.modules14a?.[recommended.module14a]?.label || recommended.module14a;
    const dynamicMarkup = Number(tariffData.dynamicTariff.spotMarkup_ct_per_kwh || 0);
    const dynamicTaxes = Number(tariffData.dynamicTariff.taxes_and_levies_ct_per_kwh || 0);
    const dynamicPriceSeries = spotPrices.map((spot) => round(spot + dynamicMarkup + dynamicTaxes, 3));
    const monthly = createMonthlySummary(totalLoad, pvHourly, storageResult.selfConsumption, storageResult.gridFeed, finalGridDraw);
    const dynamicBest = tariffs
        .filter((entry) => entry.tariffType === 'dynamic')
        .sort((a, b) => a.netCost_eur - b.netCost_eur)[0];
    const p90 = percentile(spotPrices, 90);
    const p10 = percentile(spotPrices, 10);
    const eligibilityReport = (0, dynamicTarifEligibility_1.createDynamicTarifEligibilityReport)({
        annualConsumptionKwh: totalConsumption,
        annualGridDrawKwh: totalGridDraw,
        storageCapacityKwh: request.storage.capacity_kwh || 0,
        hasStorage: request.storage.hasStorage,
        hasPv: request.pv.hasPv,
        hasHeatPump: request.heatPump.hasHeatPump,
        hasEv: request.emobility.hasEV,
        dynamicOptimization: Boolean(request.storage.useDynamicOptimization),
        staticNetCostEur: bestStatic.netCost_eur,
        dynamicNetCostEur: dynamicBest?.netCost_eur ?? bestStatic.netCost_eur,
        dynamicSpreadCtPerKwh: p90 - p10,
    });
    const annualSavingVsStatic = bestStatic.netCost_eur - recommended.netCost_eur;
    return {
        success: true,
        data: {
            monthly,
            tariffs,
            scenarios,
            spotPrices_ct_per_kwh: spotPrices.map((value) => round(value, 3)),
            dynamicTariffPrice_ct_per_kwh: dynamicPriceSeries,
            dynamicTariffComponents_ct_per_kwh: {
                spot_markup: round(dynamicMarkup, 3),
                taxes_and_levies: round(dynamicTaxes, 3),
                markup_plus_taxes: round(dynamicMarkup + dynamicTaxes, 3),
            },
            dataTransparency: [
                {
                    category: 'Haushaltslastprofil',
                    status: 'modeled',
                    source: 'BDEW-inspirierte Faktoren (lokal hinterlegt)',
                    note: 'Auf Jahresverbrauch normiert und stundenweise verteilt.',
                },
                {
                    category: 'PV-Erzeugung',
                    status: pvSource === 'pvgis-live' ? 'official' : 'modeled',
                    source: pvSource === 'pvgis-live' ? 'PVGIS API (JRC)' : 'Fallback PV Profil',
                    note: 'Bei API-Ausfall wird ein saisonales Ersatzprofil verwendet.',
                },
                {
                    category: 'Marktpreise',
                    status: 'modeled',
                    source: 'Lokales Spotpreis-Modell fuer 2025',
                    note: 'Stundenwerte werden aus Monats- und Intraday-Struktur generiert.',
                },
            ],
            eligibilityReport,
            summary: {
                pvYield_kwh: round(totalPvYield),
                totalConsumption_kwh: round(totalConsumption),
                selfConsumption_kwh: round(totalSelfConsumption),
                gridFeed_kwh: round(totalGridFeed),
                gridDraw_kwh: round(totalGridDraw),
                recommendation: recommended.label,
                recommendedTariff: recommended.name,
                recommendedModule: recommended.module14a,
                recommendedModuleLabel: moduleLabel,
                annualSavingVsStatic_eur: round(annualSavingVsStatic),
                uncertaintyBand_eur: {
                    bestCase: round(annualSavingVsStatic * 1.25),
                    expected: round(annualSavingVsStatic),
                    worstCase: round(annualSavingVsStatic * 0.75),
                },
            },
            usedParams: {
                peakpower_kwp: request.pv.peakpower_kwp || 0,
                angle_deg: request.pv.angle_deg || 30,
                aspect_deg: request.pv.aspect_deg || 0,
                coordinates: {
                    lat: coords.lat,
                    lon: coords.lon,
                },
                pvSource,
                persons: household.persons,
                buildingType: household.buildingType || 'EFH',
                storage_kwh: request.storage.capacity_kwh || 0,
                largeLoadCount: request.tariff.largeLoadCount || 0,
                largeLoadPowerKw: request.tariff.largeLoadPowerKw || 0,
                largeLoadOver42kw: Boolean(request.tariff.largeLoadOver42kw),
                largeLoadDailyCurveKw: request.tariff.largeLoadDailyCurveKw || Array.from({ length: 24 }, () => 0),
                bidiEnabled: Boolean(request.emobility.useBidirectional),
                bidiShifted_kwh: round(bidi.shiftedKwh),
            },
        },
    };
}
