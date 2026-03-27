// ── PV-API (PVGIS) ──────────────────────────────────────────────────────────
export interface PvRequest {
  lat: number;
  lon: number;
  peakpower: number;
  angle?: number;
  aspect?: number;
  loss?: number;
}
export interface PvHourlyData { time: string; P: number; }

// ── Kalkulations-Tool Input ──────────────────────────────────────────────────
export interface HouseholdConfig {
  persons: number;                    // Haushaltsgröße 1-10
  plz: string;                        // Postleitzahl
  buildingType?: 'EFH' | 'MFH' | 'Gewerbe';
  annualConsumption_kwh?: number;     // manuell überschreiben, sonst Standardprofil
}

export interface EVehicleConfig {
  batteryCapacity_kwh?: number;
  annualKm?: number;
  consumption_kwh_per_100km?: number;
  wallboxPower_kw?: number;
  useBidirectional?: boolean;
  chargingStartHour?: number;
  chargingEndHour?: number;
}

export type CurrentTariffType = 'single' | 'twoRate' | 'dynamic' | 'newCustomer';
export type MeteringPointType = 'conventional' | 'modern' | 'smart';

export interface LargeLoadConfig {
  powerKw?: number;
  startHour?: number;
  endHour?: number;
}

export interface PvConfig {
  hasPv: boolean;
  peakpower_kwp?: number;             // kWp
  angle_deg?: number;                 // Dachneigung 0–90°
  aspect_deg?: number;                // Ausrichtung: 0=Süd, -90=Ost, 90=West
  loss_pct?: number;                  // Systemverluste %
}

export interface StorageConfig {
  hasStorage: boolean;
  capacity_kwh?: number;              // Speicherkapazität
  maxPower_kw?: number;               // max. Ladeleistung
  efficiency?: number;                // Wirkungsgrad 0–1
  useDynamicOptimization?: boolean;   // kostenoptimierte Beladung
}

export interface HeatPumpConfig {
  hasHeatPump: boolean;
  annualConsumption_kwh?: number;     // jährlicher Verbrauch WP
  cop?: number;                       // COP-Wert
  use14aModule?: boolean;             // §14a-Modul nutzen
}

export interface EMobilityConfig {
  hasEV: boolean;
  annualKm?: number;                  // jährliche Fahrleistung
  consumption_kwh_per_100km?: number; // Verbrauch pro 100 km
  chargingPower_kw?: number;          // Ladeleistung der Wallbox
  preferNightCharging?: boolean;      // bevorzugt Nacht laden
  useBidirectional?: boolean;         // BiDi (V2H/V2G) aktivieren
  vehicles?: EVehicleConfig[];
}

export type TarifModul14a = 'modul1' | 'modul2' | 'modul3' | 'none';

export interface TariffConfig {
  compareStaticTariff: boolean;       // immer true
  compareDynamicTariff: boolean;
  module14a: TarifModul14a;
  largeLoadOver42kw?: boolean;
  largeLoadCount?: number;
  largeLoadPowerKw?: number;
  largeLoads?: LargeLoadConfig[];
  largeLoadDailyCurveKw?: number[];
  currentTariffType?: CurrentTariffType;
  currentAnnualCost_eur?: number;
  meteringPointType?: MeteringPointType;
  steerableConsumption_kwh?: number;
  spotPrice_eur_per_kwh?: number;
}

export interface SachsenTariffComparisonRow {
  key: string;
  tariff: 'single' | 'twoRate' | 'dynamic';
  module: 'none' | 'modul1' | 'modul2';
  label: string;
  annualCost_eur: number;
  savingVsCurrent_eur: number;
  recommended: boolean;
}

export interface SachsenTariffComparisonResult {
  currentStateCost_eur: number;
  recommendation: string;
  missingInputs: string[];
  assumptions: string[];
  rows: SachsenTariffComparisonRow[];
  inputs: {
    annualConsumption_kwh: number;
    currentTariffType: CurrentTariffType;
    meteringPointType: MeteringPointType;
    steerableConsumption_kwh: number;
    spotPrice_eur_per_kwh: number;
  };
}

export interface CalculationRequest {
  household: HouseholdConfig;
  pv: PvConfig;
  storage: StorageConfig;
  heatPump: HeatPumpConfig;
  emobility: EMobilityConfig;
  tariff: TariffConfig;
}

// ── Berechnungs-Ergebnisse ───────────────────────────────────────────────────
export interface MonthlyEnergy {
  month: string;
  pv_kwh: number;
  consumption_kwh: number;
  selfConsumption_kwh: number;
  gridFeed_kwh: number;
  gridDraw_kwh: number;
}

export interface TariffResult {
  name: string;
  label: string;
  tariffType: 'static' | 'dynamic' | 'twoRate';
  module14a: TarifModul14a;
  annualCost_eur: number;
  energyCost_eur: number;
  networkCost_eur: number;
  meterCost_eur: number;
  feedInRevenue_eur: number;
  netCost_eur: number;                // annualCost - feedInRevenue
  selfConsumptionRate_pct: number;
  autarkyRate_pct: number;
  recommended: boolean;
}

export interface ScenarioResult {
  name: string;
  label: string;
  priceFactor: number;
  recommendedTariff: string;
  recommendedNetCost_eur: number;
  staticAdjustedNetCost_eur: number;
  savingVsStatic_eur: number;
}

export interface EligibilityCheck {
  id: string;
  name: string;
  section: 'requirements' | 'technical' | 'exclusions' | 'economic';
  satisfied: boolean;
  importance: 'critical' | 'required' | 'recommended';
  reason: string;
  value?: number | boolean | string;
}

export interface DynamicTarifEligibilityReport {
  recommendedTariff: 'static' | 'dynamic';
  isEligibleForDynamic: boolean;
  confidence: 'high' | 'medium' | 'low';
  checks: EligibilityCheck[];
  requirementsMet: boolean;
  technicalMet: boolean;
  exclusionsOk: boolean;
  economicMet: boolean;
  estimatedStaticCost_eur: number;
  estimatedDynamicCost_eur: number;
  estimatedSavings_eur: number;
  estimatedSavings_pct: number;
  mainReason: string;
  detailedReasons: string[];
}

export interface CalculationResponse {
  success: boolean;
  data: {
    monthly: MonthlyEnergy[];
    tariffs: TariffResult[];
    scenarios: ScenarioResult[];
    spotPrices_ct_per_kwh: number[];
    dynamicTariffPrice_ct_per_kwh: number[];
    dynamicTariffComponents_ct_per_kwh: {
      spot_markup: number;
      taxes_and_levies: number;
      markup_plus_taxes: number;
    };
    dataTransparency: {
      category: string;
      status: 'measured' | 'official' | 'modeled';
      source: string;
      note: string;
    }[];
    sachsenComparison?: SachsenTariffComparisonResult;
    eligibilityReport?: DynamicTarifEligibilityReport;
    summary: {
      pvYield_kwh: number;
      totalConsumption_kwh: number;
      selfConsumption_kwh: number;
      gridFeed_kwh: number;
      gridDraw_kwh: number;
      recommendation: string;
      recommendedTariff: string;
      recommendedModule: TarifModul14a;
      recommendedModuleLabel: string;
      annualSavingVsStatic_eur: number;
      uncertaintyBand_eur: {
        bestCase: number;
        expected: number;
        worstCase: number;
      };
    };
    usedParams: {
      peakpower_kwp: number;
      angle_deg: number;
      aspect_deg: number;
      coordinates: { lat: number; lon: number };
      pvSource: 'pvgis-live' | 'fallback-static';
      persons: number;
      buildingType: 'EFH' | 'MFH' | 'Gewerbe';
      storage_kwh: number;
      largeLoadCount: number;
      largeLoadPowerKw: number;
      largeLoadOver42kw: boolean;
      largeLoadDailyCurveKw: number[];
      bidiEnabled: boolean;
      bidiShifted_kwh: number;
    };
  };
}