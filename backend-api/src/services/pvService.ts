import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { PvHourlyData, PvRequest } from '../types/pvTypes';

interface PvFallbackProfile {
	monthShare: number[];
	seasonByMonth: string[];
	hourShape: Record<string, number[]>;
}

export interface PvSeriesResult {
	data: PvHourlyData[];
	source: 'pvgis-live' | 'fallback-static';
}

const HOURS_PER_YEAR = 365 * 24;
const FALLBACK_CAPACITY_FACTOR = 1020; // kWh per kWp and year (central Europe simplification)

let fallbackCache: PvFallbackProfile | null = null;

function loadFallbackProfile(): PvFallbackProfile {
	if (fallbackCache) {
		return fallbackCache;
	}

	const filePath = path.join(__dirname, '../data/pvProfile.json');
	const content = fs.readFileSync(filePath, 'utf-8');
	fallbackCache = JSON.parse(content) as PvFallbackProfile;
	return fallbackCache;
}

function normalize(values: number[]): number[] {
	const sum = values.reduce((acc, value) => acc + value, 0);
	if (sum <= 0) {
		return values.map(() => 0);
	}
	return values.map((value) => value / sum);
}

function buildFallbackHourlyProfile(pvRequest: PvRequest): PvHourlyData[] {
	const profile = loadFallbackProfile();
	const monthShare = normalize(profile.monthShare || []);
	const annualKwh = Math.max(0, pvRequest.peakpower || 0) * FALLBACK_CAPACITY_FACTOR;

	const output: PvHourlyData[] = [];
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

function parsePvgisHourlyRows(rows: unknown): PvHourlyData[] {
	if (!Array.isArray(rows)) {
		return [];
	}

	return rows
		.map((row) => {
			if (!row || typeof row !== 'object') {
				return null;
			}

			const source = row as Record<string, unknown>;
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
		.filter((entry): entry is PvHourlyData => entry !== null)
		.slice(0, HOURS_PER_YEAR);
}

export async function fetchPvData(pvRequest: PvRequest): Promise<PvHourlyData[]> {
	const peakpower = Math.max(0.1, pvRequest.peakpower || 5);
	const angle = Number.isFinite(pvRequest.angle) ? pvRequest.angle : 30;
	const aspect = Number.isFinite(pvRequest.aspect) ? pvRequest.aspect : 0;
	const loss = Number.isFinite(pvRequest.loss) ? pvRequest.loss : 14;

	try {
		const response = await axios.get('https://re.jrc.ec.europa.eu/api/v5_2/seriescalc', {
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

		const rows = (response?.data as any)?.outputs?.hourly;
		const parsed = parsePvgisHourlyRows(rows);
		if (parsed.length >= HOURS_PER_YEAR * 0.9) {
			return parsed;
		}
	} catch {
		// Intentional fallback below.
	}

	return buildFallbackHourlyProfile({ ...pvRequest, peakpower });
}

export async function fetchPvDataWithSource(pvRequest: PvRequest): Promise<PvSeriesResult> {
	const peakpower = Math.max(0.1, pvRequest.peakpower || 5);
	const angle = Number.isFinite(pvRequest.angle) ? pvRequest.angle : 30;
	const aspect = Number.isFinite(pvRequest.aspect) ? pvRequest.aspect : 0;
	const loss = Number.isFinite(pvRequest.loss) ? pvRequest.loss : 14;

	try {
		const response = await axios.get('https://re.jrc.ec.europa.eu/api/v5_2/seriescalc', {
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

		const rows = (response?.data as any)?.outputs?.hourly;
		const parsed = parsePvgisHourlyRows(rows);
		if (parsed.length >= HOURS_PER_YEAR * 0.9) {
			return { data: parsed, source: 'pvgis-live' };
		}
	} catch {
		// Intentional fallback below.
	}

	return {
		data: buildFallbackHourlyProfile({ ...pvRequest, peakpower }),
		source: 'fallback-static',
	};
}

