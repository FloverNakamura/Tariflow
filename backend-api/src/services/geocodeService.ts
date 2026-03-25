import * as fs from 'fs';
import * as path from 'path';

let plzData: any[];
try {
  const filePath = path.join(__dirname, '../data/plzKoords.json');
  console.log('Loading PLZ data from:', filePath);
  const data = fs.readFileSync(filePath, 'utf-8');
  plzData = JSON.parse(data);
  console.log('PLZ data loaded:', plzData.length, 'entries');
} catch (error) {
  console.error('Error loading PLZ data:', error);
  plzData = [];
}

export function getCoordsFromPlz(plz: string): { lat: number; lon: number } {
  const plzNum = parseInt(plz, 10);
  const entry = plzData.find((item: any) => plzNum >= item.from && plzNum <= item.to);
  if (entry) {
    return { lat: entry.lat, lon: entry.lon };
  }
  // Fallback
  return { lat: 51.05, lon: 13.74 };
}