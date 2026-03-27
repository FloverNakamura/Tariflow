import * as fs from 'fs';
import * as path from 'path';

interface Coords {
	lat: number;
	lon: number;
}

interface PlzData {
	exact?: Record<string, Coords>;
	prefix2?: Record<string, Coords>;
}

let cached: PlzData | null = null;

function loadPlzData(): PlzData {
	if (cached) {
		return cached;
	}

	try {
		const filePath = path.join(__dirname, '../data/plzKoords.json');
		const content = fs.readFileSync(filePath, 'utf-8');
		cached = JSON.parse(content) as PlzData;
	} catch {
		cached = { exact: {}, prefix2: {} };
	}

	return cached;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizePlz(plz: string): string {
	return String(plz || '').trim().replace(/\D/g, '').slice(0, 5);
}

function deterministicOffset(seed: string): number {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
	}
	return ((hash % 1000) / 1000 - 0.5) * 0.18;
}

export function getCoordsFromPlz(plz: string): Coords {
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

