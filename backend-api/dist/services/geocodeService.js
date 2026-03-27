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
exports.getCoordsFromPlz = getCoordsFromPlz;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let cached = null;
function loadPlzData() {
    if (cached) {
        return cached;
    }
    try {
        const filePath = path.join(__dirname, '../data/plzKoords.json');
        const content = fs.readFileSync(filePath, 'utf-8');
        cached = JSON.parse(content);
    }
    catch {
        cached = { exact: {}, prefix2: {} };
    }
    return cached;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function normalizePlz(plz) {
    return String(plz || '').trim().replace(/\D/g, '').slice(0, 5);
}
function deterministicOffset(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
    }
    return ((hash % 1000) / 1000 - 0.5) * 0.18;
}
function getCoordsFromPlz(plz) {
    const normalizedPlz = normalizePlz(plz);
    const data = loadPlzData();
    const exactHit = data.exact?.[normalizedPlz];
    if (exactHit) {
        return exactHit;
    }
    const prefix = normalizedPlz.slice(0, 2);
    const prefixHit = prefix ? data.prefix2?.[prefix] : undefined;
    if (prefixHit) {
        const lat = clamp(prefixHit.lat + deterministicOffset(`${normalizedPlz}-lat`), 47.2, 55.1);
        const lon = clamp(prefixHit.lon + deterministicOffset(`${normalizedPlz}-lon`), 5.4, 15.6);
        return {
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5)),
        };
    }
    return { lat: 51.1657, lon: 10.4515 };
}
