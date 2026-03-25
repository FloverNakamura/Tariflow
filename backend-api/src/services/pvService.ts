import axios from 'axios';
import { PvRequest, PvHourlyData } from '../types/pvTypes';

export async function fetchPvData(params: PvRequest): Promise<PvHourlyData[]> {
  const url = 'https://re.jrc.ec.europa.eu/api/v5_2/seriescalc';
  const query = {
    lat: params.lat,
    lon: params.lon,
    peakpower: params.peakpower,
    angle: params.angle ?? 30,
    aspect: params.aspect ?? 0,   // PVGIS convention: 0 = Süd, -90 = Ost, 90 = West
    loss: params.loss ?? 14,
    pvcalculation: 1,
    outputformat: 'json',
    startyear: 2020,              // PVGIS erlaubt max. 2020; Schaltjahr-Normierung erfolgt in calcService
    endyear: 2020,
    usehorizon: 1,
    components: 1
  };
  const response = await axios.get(url, { params: query, timeout: 12000 });
  const hourly = (response.data as any).outputs.hourly;
  return hourly.map((item: any) => ({ time: item.time, P: item.P }));
}