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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPvData = fetchPvData;
exports.fetchPvDataWithSource = fetchPvDataWithSource;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const HOURS_PER_YEAR = 365 * 24;
const FALLBACK_CAPACITY_FACTOR = 1020; // kWh per kWp and year (central Europe simplification)
let fallbackCache = null;
function loadFallbackProfile() {
    if (fallbackCache) {
        return fallbackCache;
    }
    const filePath = path.join(__dirname, '../data/pvProfile.json');
    const content = fs.readFileSync(filePath, 'utf-8');
    fallbackCache = JSON.parse(content);
    return fallbackCache;
}
function normalize(values) {
    const sum = values.reduce((acc, value) => acc + value, 0);
    if (sum <= 0) {
        return values.map(() => 0);
    }
    return values.map((value) => value / sum);
}
function buildFallbackHourlyProfile(pvRequest) {
    const profile = loadFallbackProfile();
    const monthShare = normalize(profile.monthShare || []);
    const annualKwh = Math.max(0, pvRequest.peakpower || 0) * FALLBACK_CAPACITY_FACTOR;
    const output = [];
    let runningIdx = 0;
    for (let month = 0; month < 12; month++) {
        const days = new Date(2025, month + 1, 0).getDate();
        const monthKwh = annualKwh * (monthShare[month] || 0);
        const season = profile.seasonByMonth?.[month] || 'spring';
        const hourShape = normalize(profile.hourShape?.[season] || Array.from({ length: 24 }, () => 1));
        for (let day = 0; day < days; day++) {
            for (let hour = 0; hour < 24; hour++) {
                const kwh = (monthKwh / days) * hourShape[hour];
                const date = new Date(Date.UTC(2025, month, day + 1, hour, 0, 0));
                output.push({
                    time: date.toISOString(),
                    P: Number((kwh * 1000).toFixed(4)),
                });
                runningIdx++;
            }
        }
    }
    if (output.length < HOURS_PER_YEAR) {
        while (output.length < HOURS_PER_YEAR) {
            const date = new Date(Date.UTC(2025, 0, 1, output.length % 24, 0, 0));
            output.push({ time: date.toISOString(), P: 0 });
        }
    }
    return output.slice(0, HOURS_PER_YEAR);
}
function parsePvgisHourlyRows(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        if (!row || typeof row !== 'object') {
            return null;
        }
        const source = row;
        const power = Number(source.P);
        const time = String(source.time || '');
        if (!Number.isFinite(power) || !time) {
            return null;
        }
        const normalizedTime = time.includes(':')
            ? time
            : `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}T${time.slice(9, 11)}:00:00Z`;
        return {
            time: normalizedTime,
            P: Math.max(0, power),
        };
    })
        .filter((entry) => entry !== null)
        .slice(0, HOURS_PER_YEAR);
}
async function fetchPvData(pvRequest) {
    const peakpower = Math.max(0.1, pvRequest.peakpower || 5);
    const angle = Number.isFinite(pvRequest.angle) ? pvRequest.angle : 30;
    const aspect = Number.isFinite(pvRequest.aspect) ? pvRequest.aspect : 0;
    const loss = Number.isFinite(pvRequest.loss) ? pvRequest.loss : 14;
    try {
        const response = await axios_1.default.get('https://re.jrc.ec.europa.eu/api/v5_2/seriescalc', {
            timeout: 14000,
            params: {
                lat: pvRequest.lat,
                lon: pvRequest.lon,
                peakpower,
                angle,
                aspect,
                loss,
                outputformat: 'json',
                pvtechchoice: 'crystSi',
                mountingplace: 'building',
                usehorizon: 1,
            },
        });
        const rows = response?.data?.outputs?.hourly;
        const parsed = parsePvgisHourlyRows(rows);
        if (parsed.length >= HOURS_PER_YEAR * 0.9) {
            return parsed;
        }
    }
    catch {
        // Intentional fallback below.
    }
    return buildFallbackHourlyProfile({ ...pvRequest, peakpower });
}
async function fetchPvDataWithSource(pvRequest) {
    const peakpower = Math.max(0.1, pvRequest.peakpower || 5);
    const angle = Number.isFinite(pvRequest.angle) ? pvRequest.angle : 30;
    const aspect = Number.isFinite(pvRequest.aspect) ? pvRequest.aspect : 0;
    const loss = Number.isFinite(pvRequest.loss) ? pvRequest.loss : 14;
    try {
        const response = await axios_1.default.get('https://re.jrc.ec.europa.eu/api/v5_2/seriescalc', {
            timeout: 14000,
            params: {
                lat: pvRequest.lat,
                lon: pvRequest.lon,
                peakpower,
                angle,
                aspect,
                loss,
                outputformat: 'json',
                pvtechchoice: 'crystSi',
                mountingplace: 'building',
                usehorizon: 1,
            },
        });
        const rows = response?.data?.outputs?.hourly;
        const parsed = parsePvgisHourlyRows(rows);
        if (parsed.length >= HOURS_PER_YEAR * 0.9) {
            return { data: parsed, source: 'pvgis-live' };
        }
    }
    catch {
        // Intentional fallback below.
    }
    return {
        data: buildFallbackHourlyProfile({ ...pvRequest, peakpower }),
        source: 'fallback-static',
    };
}
