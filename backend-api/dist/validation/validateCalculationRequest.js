"use strict";
/**
 * validateCalculationRequest.ts
 *
 * Sanitizes and validates the body of POST /api/calculate.
 * Returns a validated + coerced request object, or throws an error
 * whose message can be sent directly to the client as a 422.
 *
 * Design goals:
 *  - All numeric fields are coerced to numbers (string "5" → 5)
 *  - Out-of-range values are clamped to real-world bounds
 *  - Missing optional fields get sensible defaults
 *  - Unknown/invalid enum values fall back to the safest option
 *  - No NaN / Infinity values ever reach the calculation engine
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAndSanitize = validateAndSanitize;
// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function toBool(value, fallback) {
    if (typeof value === 'boolean')
        return value;
    if (value === 'true' || value === 1)
        return true;
    if (value === 'false' || value === 0)
        return false;
    return fallback;
}
function toModule(value) {
    if (value === 'modul1' || value === 'modul2' || value === 'modul3')
        return value;
    return 'none';
}
function toPersons(value) {
    const n = Number(value);
    if (n >= 1 && n <= 10 && Number.isInteger(n))
        return n;
    return 2; // safest default
}
function sanitizeVehicles(value, fallbackUseBidirectional) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => entry && typeof entry === 'object')
        .slice(0, 10)
        .map((entry) => {
        const vehicle = entry;
        return {
            batteryCapacity_kwh: clamp(toNum(vehicle.batteryCapacity_kwh, 60), 10, 200),
            annualKm: clamp(toNum(vehicle.annualKm, 12000), 100, 200000),
            consumption_kwh_per_100km: clamp(toNum(vehicle.consumption_kwh_per_100km, 20), 5, 60),
            wallboxPower_kw: clamp(toNum(vehicle.wallboxPower_kw, 11), 1.4, 22),
            useBidirectional: toBool(vehicle.useBidirectional, fallbackUseBidirectional),
        };
    });
}
function toBuildingType(value) {
    if (value === 'EFH' || value === 'MFH' || value === 'Gewerbe')
        return value;
    return 'EFH';
}
function sanitizeLargeLoads(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => entry && typeof entry === 'object')
        .slice(0, 30)
        .map((entry) => {
        const load = entry;
        return {
            powerKw: clamp(toNum(load.powerKw, 5), 0, 500),
            startHour: clamp(Math.round(toNum(load.startHour, 0)), 0, 23),
            endHour: clamp(Math.round(toNum(load.endHour, 0)), 0, 23),
        };
    })
        .filter((load) => (load.powerKw ?? 0) > 0);
}
function buildLargeLoadDailyCurveKw(loads) {
    const curve = Array.from({ length: 24 }, () => 0);
    loads.forEach((load) => {
        const powerKw = load.powerKw ?? 0;
        const start = load.startHour ?? 0;
        const end = load.endHour ?? 0;
        for (let h = 0; h < 24; h++) {
            const active = start === end ? true : (start < end ? (h >= start && h < end) : (h >= start || h < end));
            if (active) {
                curve[h] += powerKw;
            }
        }
    });
    return curve.map((value) => Math.round(value * 100) / 100);
}
// PLZ: must be a 5-digit string of digits (German postal code format)
const PLZ_RE = /^\d{5}$/;
// ── Main validator / sanitizer ────────────────────────────────────────────────
function validateAndSanitize(body) {
    if (body === null || typeof body !== 'object') {
        throw new Error('Ungültiger Request-Body: kein JSON-Objekt.');
    }
    const b = body;
    // ── Household ──────────────────────────────────────────────────────────────
    const hh = (b.household && typeof b.household === 'object')
        ? b.household
        : {};
    const plz = String(hh.plz ?? '');
    if (!PLZ_RE.test(plz)) {
        throw new Error(`Ungültige PLZ "${plz}". Bitte eine gültige 5-stellige deutsche Postleitzahl angeben.`);
    }
    const annualConsRaw = hh.annualConsumption_kwh != null
        ? toNum(hh.annualConsumption_kwh, NaN)
        : NaN;
    const annualConsumption_kwh = Number.isFinite(annualConsRaw) && annualConsRaw > 0
        ? clamp(annualConsRaw, 500, 100000) // plausible range
        : undefined; // will fall back to BDEW profile
    // ── PV ─────────────────────────────────────────────────────────────────────
    const pvRaw = (b.pv && typeof b.pv === 'object') ? b.pv : {};
    const hasPv = toBool(pvRaw.hasPv, false);
    const pv = {
        hasPv,
        peakpower_kwp: hasPv ? clamp(toNum(pvRaw.peakpower_kwp, 5), 0.5, 1000) : 0,
        angle_deg: clamp(toNum(pvRaw.angle_deg, 30), 0, 90),
        aspect_deg: clamp(toNum(pvRaw.aspect_deg, 0), -180, 180),
        loss_pct: clamp(toNum(pvRaw.loss_pct, 14), 0, 30),
    };
    // ── Storage ────────────────────────────────────────────────────────────────
    const stRaw = (b.storage && typeof b.storage === 'object') ? b.storage : {};
    const hasStorage = toBool(stRaw.hasStorage, false);
    const storage = {
        hasStorage,
        capacity_kwh: hasStorage ? clamp(toNum(stRaw.capacity_kwh, 5), 0.5, 500) : 0,
        maxPower_kw: hasStorage ? clamp(toNum(stRaw.maxPower_kw, 3), 0.1, 200) : 0,
        efficiency: clamp(toNum(stRaw.efficiency, 0.92), 0.5, 1.0),
        useDynamicOptimization: toBool(stRaw.useDynamicOptimization, false),
    };
    // ── Heat Pump ──────────────────────────────────────────────────────────────
    const hpRaw = (b.heatPump && typeof b.heatPump === 'object') ? b.heatPump : {};
    const hasHeatPump = toBool(hpRaw.hasHeatPump, false);
    const heatPump = {
        hasHeatPump,
        annualConsumption_kwh: hasHeatPump
            ? clamp(toNum(hpRaw.annualConsumption_kwh, 3000), 100, 50000)
            : 0,
        cop: clamp(toNum(hpRaw.cop, 3), 1.5, 8),
        use14aModule: toBool(hpRaw.use14aModule, false),
    };
    // ── E-Mobility ─────────────────────────────────────────────────────────────
    const evRaw = (b.emobility && typeof b.emobility === 'object') ? b.emobility : {};
    const fallbackUseBidirectional = toBool(evRaw.useBidirectional, false);
    const vehicles = sanitizeVehicles(evRaw.vehicles, fallbackUseBidirectional);
    const hasEV = toBool(evRaw.hasEV, false) || vehicles.length > 0;
    const legacyAnnualKm = hasEV ? clamp(toNum(evRaw.annualKm, 12000), 100, 200000) : 0;
    const legacyConsumption = clamp(toNum(evRaw.consumption_kwh_per_100km, 20), 5, 60);
    const normalizedVehicles = vehicles.length
        ? vehicles
        : hasEV
            ? [{
                    batteryCapacity_kwh: clamp(toNum(evRaw.batteryCapacity_kwh, 60), 10, 200),
                    annualKm: legacyAnnualKm,
                    consumption_kwh_per_100km: legacyConsumption,
                    wallboxPower_kw: clamp(toNum(evRaw.chargingPower_kw, 11), 1.4, 22),
                    useBidirectional: fallbackUseBidirectional,
                }]
            : [];
    const emobility = {
        hasEV: normalizedVehicles.length > 0,
        annualKm: normalizedVehicles.reduce((sum, vehicle) => sum + (vehicle.annualKm || 0), 0),
        consumption_kwh_per_100km: legacyConsumption,
        chargingPower_kw: clamp(toNum(evRaw.chargingPower_kw, 11), 1.4, 350),
        preferNightCharging: toBool(evRaw.preferNightCharging, true),
        useBidirectional: normalizedVehicles.some((vehicle) => vehicle.useBidirectional),
        vehicles: normalizedVehicles,
    };
    // ── Tariff ─────────────────────────────────────────────────────────────────
    const taRaw = (b.tariff && typeof b.tariff === 'object') ? b.tariff : {};
    const largeLoads = sanitizeLargeLoads(taRaw.largeLoads);
    const legacyLargeLoadCount = clamp(Math.round(toNum(taRaw.largeLoadCount, 0)), 0, 100);
    const legacyLargeLoadPowerKw = clamp(toNum(taRaw.largeLoadPowerKw, 0), 0, 500);
    const normalizedLargeLoads = largeLoads.length
        ? largeLoads
        : (legacyLargeLoadCount > 0 && legacyLargeLoadPowerKw > 0)
            ? Array.from({ length: legacyLargeLoadCount }, () => ({
                powerKw: legacyLargeLoadPowerKw,
                startHour: 0,
                endHour: 0,
            }))
            : [];
    const largeLoadCount = normalizedLargeLoads.length;
    const largeLoadPowerKw = normalizedLargeLoads.reduce((max, load) => Math.max(max, load.powerKw ?? 0), 0);
    const largeLoadDailyCurveKw = buildLargeLoadDailyCurveKw(normalizedLargeLoads);
    const largeLoadOver42kw = toBool(taRaw.largeLoadOver42kw, false)
        || normalizedLargeLoads.some((load) => (load.powerKw ?? 0) >= 4.2);
    const tariff = {
        compareStaticTariff: true, // always compare static
        compareDynamicTariff: true,
        module14a: 'none',
        largeLoadOver42kw,
        largeLoadCount,
        largeLoadPowerKw,
        largeLoads: normalizedLargeLoads,
        largeLoadDailyCurveKw,
    };
    return {
        household: {
            persons: toPersons(hh.persons),
            plz,
            buildingType: toBuildingType(hh.buildingType),
            ...(annualConsumption_kwh !== undefined && { annualConsumption_kwh }),
        },
        pv,
        storage,
        heatPump,
        emobility,
        tariff,
    };
}
