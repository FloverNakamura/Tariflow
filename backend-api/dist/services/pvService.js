"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPvData = fetchPvData;
const axios_1 = __importDefault(require("axios"));
async function fetchPvData(params) {
    const url = 'https://re.jrc.ec.europa.eu/api/v5_2/seriescalc';
    const query = {
        lat: params.lat,
        lon: params.lon,
        peakpower: params.peakpower,
        angle: params.angle ?? 30,
        aspect: params.aspect ?? 0, // PVGIS convention: 0 = Süd, -90 = Ost, 90 = West
        loss: params.loss ?? 14,
        pvcalculation: 1,
        outputformat: 'json',
        startyear: 2020, // PVGIS erlaubt max. 2020; Schaltjahr-Normierung erfolgt in calcService
        endyear: 2020,
        usehorizon: 1,
        components: 1
    };
    const response = await axios_1.default.get(url, { params: query, timeout: 12000 });
    const hourly = response.data.outputs.hourly;
    return hourly.map((item) => ({ time: item.time, P: item.P }));
}
