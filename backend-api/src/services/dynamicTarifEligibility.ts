/**
 * Dynamische Tarif-Eligibility Service
 * 
 * Implementiert alle Regeln für Empfehlung von dynamischen vs. statischen Tarifen:
 * - Mindestvoraussetzungen (intelligentes Messsystem, Steuerbarkeit, etc.)
 * - Technische Voraussetzungen (Technologie-Mix)
 * - Ausschlussregeln (starre Nutzungsmuster)
 * - Wirtschaftliche Simulation
 * 
 * Kernregel: Dynamisch NUR wenn alle Bedingungen erfüllt UND klarer Kostenvorteil
 */

import { CalculationRequest } from '../types/pvTypes';

// ── Konstanten (als zentrale Defintion) ──────────────────────────────────────
export const THRESHOLDS = {
  // Mindestvoraussetzungen
  minShiftableShare_pct: 25,        // Mind. 25% versch. Last
  minPeakConsumption_pct: 60,       // Max. 60% in Peak-Zeiten
  minFlexibleWindow_hours: 4,       // Mind. 4 Std. flexibles Fenster
  minLargeLoadPower_kw: 4.2,        // Großverbraucher-Schwelle
  
  // Technische Voraussetzungen
  minCopForHeatPump: 3,             // WP COP ≥ 3
  minEVFlexWindow_hours: 6,         // EV flexibles Laden ≥ 6 Std.
  
  // Ausschlussregeln
  maxConsumptionInPeak_pct: 70,     // > 70% in Peak → statisch
  minAnnualConsumption_kwh: 2000,   // < 2000 kWh → statisch
  
  // Wirtschaftliche Simulation
  minSavingsForDynamic_pct: 15,     // Mind. 15% günstiger
  maxSavingsForStatic_pct: 10,      // < 10% Differenz → statisch
};

export const PEAK_HOURS = [6, 7, 8, 17, 18, 19, 20];  // 6-9 Uhr, 17-21 Uhr

/**
 * Einzelne Bedingung mit Ergebnis und Begründung
 */
export interface ConditionCheck {
  id: string;                        // z.B. 'has_smart_meter'
  name: string;                      // Lesbare Bezeichnung
  section: 'requirements' | 'technical' | 'exclusions' | 'economic';
  satisfied: boolean;
  importance: 'critical' | 'required' | 'recommended';  // critical = Veto, required = Muss, recommended = Sollte
  reason: string;                    // Erklärung
  value?: number | boolean | string; // Aktueller Wert zur Anzeige
}

/**
 * Vollständiger Eligibility-Report
 */
export interface DynamicTarifEligibilityReport {
  recommendedTariff: 'static' | 'dynamic';  // Empfehlung
  isEligibleForDynamic: boolean;            // Technische Eignung
  confidence: 'high' | 'medium' | 'low';    // Konfidenz der Aussage
  
  checks: ConditionCheck[];                 // Alle geprüften Bedingungen
  
  // Zusammenfassung nach Kategorien
  requirementsMet: boolean;
  technicalMet: boolean;
  exclusionsOk: boolean;
  economicMet: boolean;
  
  // Wirtschaftliche Daten
  estimatedStaticCost_eur: number;
  estimatedDynamicCost_eur: number;
  estimatedSavings_eur: number;
  estimatedSavings_pct: number;
  
  // Verbale Begründung für Endnutzer
  mainReason: string;
  detailedReasons: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
/**
 * 1. EINGABEN VERARBEITEN & KENNZAHLEN ABLEITEN
 */
// ──────────────────────────────────────────────────────────────────────────────

export interface UserInputMetrics {
  // Basis
  plz: string;
  livingArea_m2: number;
  
  // Stromverbrauch
  annualConsumption_kwh: number;
  
  // Große Verbraucher
  largeLoadCount: number;
  largeLoadPowerKw: number;
  largeLoadControllable: boolean;
  
  // Wärmepumpe
  hasHeatPump: boolean;
  hpConsumption_kwh: number;
  hpCop: number;
  
  // Elektrofahrzeug
  hasEV: boolean;
  evBatteryKwh: number;
  evWallboxPowerKw: number;
  evChargingWindowHours: number;  // 0 = fest, >0 = variabel
  evControllable: boolean;
  
  // PV
  pvPowerKwp: number;
  
  // Speicher
  storageCapacityKwh: number;
  
  // Heizung
  hasHeating: boolean;
  heatingConsumption_kwh: number;
  
  // Verbraucherverhalten
  hasSmartMeter: boolean;
  hasControllableDevices: boolean;
  userAcceptsVariableCosts: boolean;  // Bereitschaft für Schwankungen
}

/**
 * Derived Metrics aus Input
 */
export interface DerivedMetrics {
  shiftableLoadShare_pct: number;        // Anteil verschiebbarer Last
  peakHourConsumption_pct: number;       // % der Last in Peak-Zeiten (6-9, 17-21)
  hasAutomationCapability: boolean;      // Automatisierung vorhanden
  flexibleWindow_hours: number;          // Längste flexible Nutzer-Zeit (für EV/WP)
}

/**
 * Berechne Kennzahlen aus Input-Daten
 */
export function deriveMetrics(input: UserInputMetrics): DerivedMetrics {
  // Schätzung: Große Verbraucher + EV + WP sind verschiebbar
  let shiftableKwh = 0;
  
  if (input.largeLoadControllable) {
    // Große Verbraucher: angenommener Jahresverbrauch 10-20% des Gesamts
    shiftableKwh += input.largeLoadPowerKw * 2000;  // Grobe Schätzung: kW * 2000h/Jahr
  }
  
  if (input.hasEV && input.evControllable && input.evChargingWindowHours >= 4) {
    // EV: angenommener Jahresverbrauch = Batterie * 50 Ladevorgänge/Jahr
    shiftableKwh += input.evBatteryKwh * 50;
  }
  
  if (input.hasHeatPump) {
    // WP: ca. 50% des Verbrauchs verschiebbar (wenn Controller vorhanden)
    shiftableKwh += input.hpConsumption_kwh * 0.5;
  }
  
  const shiftableShare = input.annualConsumption_kwh > 0
    ? (shiftableKwh / input.annualConsumption_kwh) * 100
    : 0;
  
  // Peak-Zeiten: typisches Lastprofil für 6-9 Uhr (15%) + 17-21 Uhr (20%) ≈ 35%
  // Vereinfachung: 35% Standard, ggf. anpassbar
  const peakShare = 35;  // Default: 35% der Last in Peak-Zeiten
  
  // Automatisierung: vorhanden wenn intelligenter Zähler ODER steuerbare Geräte
  const hasAutomation = input.hasSmartMeter || input.hasControllableDevices;
  
  // Flexibles Fenster: längste verfügbare Zeit zwischen EV-Laden und WP-Steuerung
  let flexibleHours = 0;
  if (input.hasEV && input.evChargingWindowHours > 0) {
    flexibleHours = Math.max(flexibleHours, input.evChargingWindowHours);
  }
  if (input.hasHeatPump) {
    flexibleHours = Math.max(flexibleHours, 12);  // WP-Speicher typ. 12-24 Std
  }
  
  return {
    shiftableLoadShare_pct: Math.round(shiftableShare * 10) / 10,
    peakHourConsumption_pct: peakShare,
    hasAutomationCapability: hasAutomation,
    flexibleWindow_hours: flexibleHours,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
/**
 * 2. MINDESTVORAUSSETZUNGEN FÜR DYNAMISCHEN TARIF
 */
// ──────────────────────────────────────────────────────────────────────────────

export function checkMinimumRequirements(
  input: UserInputMetrics,
  derived: DerivedMetrics
): ConditionCheck[] {
  const checks: ConditionCheck[] = [];
  
  // R1: Intelligentes Messsystem ODER steuerbare Geräte
  checks.push({
    id: 'has_smart_meter_or_controllable',
    name: 'Intelligentes Messsystem oder steuerbare Geräte',
    section: 'requirements',
    satisfied: input.hasSmartMeter || input.hasControllableDevices,
    importance: 'critical',
    reason: input.hasSmartMeter
      ? 'Intelligentes Messsystem vorhanden → Fernsteuerung möglich'
      : input.hasControllableDevices
        ? 'Steuerbare Geräte vorhanden → manuelle/automatische Optimierung'
        : 'Weder intelligenter Zähler noch steuerbare Geräte → keine Flexibilität',
    value: `${input.hasSmartMeter ? 'iMSys' : input.hasControllableDevices ? 'Steuerbare Geräte' : 'Keine'}`
  });
  
  // R2: Mind. 25% verschiebbarer Last
  const shiftable = derived.shiftableLoadShare_pct;
  checks.push({
    id: 'min_shiftable_load',
    name: `Mindestens 25% versch. Last (aktuell: ${Math.round(shiftable)}%)`,
    section: 'requirements',
    satisfied: shiftable >= THRESHOLDS.minShiftableShare_pct,
    importance: 'critical',
    reason: shiftable >= THRESHOLDS.minShiftableShare_pct
      ? `${Math.round(shiftable)}% Anteil verschiebbar → ausreichende Optimierungsmöglichkeit`
      : `Nur ${Math.round(shiftable)}% verschiebbar → zu wenig Flexibilität`,
    value: `${Math.round(shiftable)}%`
  });
  
  // R3: Mind. ein großer Verbraucher steuerbar (> 4,2 kW)
  const hasControlledLargeLoad = input.largeLoadPowerKw >= THRESHOLDS.minLargeLoadPower_kw && input.largeLoadControllable;
  checks.push({
    id: 'large_load_controllable',
    name: `Großer steuerbarer Verbraucher ≥ ${THRESHOLDS.minLargeLoadPower_kw} kW`,
    section: 'requirements',
    satisfied: hasControlledLargeLoad,
    importance: 'critical',
    reason: hasControlledLargeLoad
      ? `Verbraucher ${input.largeLoadPowerKw} kW vorhanden & steuerbar`
      : input.largeLoadPowerKw >= THRESHOLDS.minLargeLoadPower_kw
        ? `Verbraucher ${input.largeLoadPowerKw} kW vorhanden, aber nicht steuerbar`
        : `Kein Großverbraucher ≥ ${THRESHOLDS.minLargeLoadPower_kw} kW`,
    value: input.largeLoadControllable ? `${input.largeLoadPowerKw} kW (steuerbar)` : `${input.largeLoadPowerKw} kW (nicht steuerbar)`
  });
  
  // R4: Verbrauch in Peakzeiten ≤ 60%
  const peakConsumption = derived.peakHourConsumption_pct;
  checks.push({
    id: 'peak_consumption_limit',
    name: `Verbrauch in Peak-Zeiten ≤ 60% (aktuell: ${Math.round(peakConsumption)}%)`,
    section: 'requirements',
    satisfied: peakConsumption <= THRESHOLDS.minPeakConsumption_pct,
    importance: 'critical',
    reason: peakConsumption <= THRESHOLDS.minPeakConsumption_pct
      ? `${Math.round(peakConsumption)}% in Peak-Zeiten → Optimierungspotenzial`
      : `${Math.round(peakConsumption)}% in Peak-Zeiten → zu viel Locked-in-Last`,
    value: `${Math.round(peakConsumption)}%`
  });
  
  // R5: Flexibles Nutzungsfenster ≥ 4 Std/Tag
  checks.push({
    id: 'flexible_window',
    name: `Flexibles Nutzungsfenster ≥ 4 Std/Tag (vorhanden: ${derived.flexibleWindow_hours} Std)`,
    section: 'requirements',
    satisfied: derived.flexibleWindow_hours >= THRESHOLDS.minFlexibleWindow_hours,
    importance: 'required',
    reason: derived.flexibleWindow_hours >= THRESHOLDS.minFlexibleWindow_hours
      ? `${derived.flexibleWindow_hours} Stunden flexibles Fenster → Verschiebbarkeit`
      : `Nur ${derived.flexibleWindow_hours} Std flexibel → begrenzte Optionen`,
    value: `${derived.flexibleWindow_hours} h`
  });
  
  return checks;
}

// ──────────────────────────────────────────────────────────────────────────────
/**
 * 3. TECHNISCHE VORAUSSETZUNGEN
 */
// ──────────────────────────────────────────────────────────────────────────────

export function checkTechnicalRequirements(input: UserInputMetrics): ConditionCheck[] {
  const checks: ConditionCheck[] = [];
  
  const hpQualifies = input.hasHeatPump && (input.hpCop || 0) >= THRESHOLDS.minCopForHeatPump;
  const evQualifies = input.hasEV && input.evChargingWindowHours >= THRESHOLDS.minEVFlexWindow_hours;
  const pvPresent = input.pvPowerKwp > 0;
  const storagePresent = input.storageCapacityKwh > 0;
  
  // T1: WP mit COP ≥ 3
  checks.push({
    id: 'heat_pump_cop',
    name: `Wärmepumpe mit COP ≥ ${THRESHOLDS.minCopForHeatPump}`,
    section: 'technical',
    satisfied: hpQualifies,
    importance: 'recommended',
    reason: hpQualifies
      ? `WP mit COP ${input.hpCop} vorhanden → gute Effizienz, dynamisch steuerbar`
      : input.hasHeatPump
        ? `WP vorhanden, aber COP ${input.hpCop} < 3 → begrenzte Eignung`
        : 'Keine Wärmepumpe',
    value: input.hasHeatPump ? `COP ${input.hpCop}` : 'Keine'
  });
  
  // T2: EV mit flexiblem Laden (≥ 6 Std)
  checks.push({
    id: 'ev_flexible_charging',
    name: `Elektrofahrzeug mit flexiblem Laden ≥ ${THRESHOLDS.minEVFlexWindow_hours} Std`,
    section: 'technical',
    satisfied: evQualifies,
    importance: 'recommended',
    reason: evQualifies
      ? `EV mit ${input.evChargingWindowHours}h flexiblem Fenster → Optimierungspotenzial`
      : input.hasEV
        ? `EV vorhanden, aber Fenster nur ${input.evChargingWindowHours}h → wenig Flex`
        : 'Kein Elektrofahrzeug',
    value: input.hasEV ? `${input.evChargingWindowHours}h Fenster` : 'Keine'
  });
  
  // T3: PV-Anlage
  checks.push({
    id: 'pv_present',
    name: 'PV-Anlage vorhanden',
    section: 'technical',
    satisfied: pvPresent,
    importance: 'recommended',
    reason: pvPresent
      ? `${input.pvPowerKwp} kWp → Erzeugungsprofil für Optimierung`
      : 'Keine PV → weniger Flexibilität',
    value: pvPresent ? `${input.pvPowerKwp} kWp` : 'Keine'
  });
  
  // T4: Stromspeicher
  checks.push({
    id: 'battery_storage',
    name: 'Stromspeicher vorhanden',
    section: 'technical',
    satisfied: storagePresent,
    importance: 'recommended',
    reason: storagePresent
      ? `${input.storageCapacityKwh} kWh → zeitliche Verschiebung möglich`
      : 'Kein Speicher → direkte Kopplung an Erzeugung/Preis',
    value: storagePresent ? `${input.storageCapacityKwh} kWh` : 'Keine'
  });
  
  return checks;
}

// ──────────────────────────────────────────────────────────────────────────────
/**
 * 4. AUSSCHLUSSREGELN FÜR DYNAMISCH
 */
// ──────────────────────────────────────────────────────────────────────────────

export function checkExclusionRules(
  input: UserInputMetrics,
  derived: DerivedMetrics
): ConditionCheck[] {
  const checks: ConditionCheck[] = [];
  
  // E1: Keine Steuerbarkeit
  const hasControlCapability = input.hasSmartMeter || input.hasControllableDevices;
  checks.push({
    id: 'has_control_capability',
    name: 'Steuerbarkeit vorhanden',
    section: 'exclusions',
    satisfied: hasControlCapability,
    importance: 'critical',
    reason: hasControlCapability
      ? 'Intelligente Steuerung möglich'
      : 'Keine Steuerbarkeit → dynamischer Tarif nicht sinnvoll',
    value: hasControlCapability ? 'Ja' : 'Nein'
  });
  
  // E2: Feste Ladezeiten ohne Verschiebung
  const hasEVFlexibility = !input.hasEV || input.evChargingWindowHours > 0;
  checks.push({
    id: 'no_fixed_ev_charging',
    name: 'EV-Laden nicht völlig festgelegt',
    section: 'exclusions',
    satisfied: hasEVFlexibility,
    importance: 'critical',
    reason: hasEVFlexibility
      ? input.hasEV
        ? `EV-Laden flexibel planbar (${input.evChargingWindowHours}h Fenster)`
        : 'Kein EV'
      : 'EV nur zu Stoßzeiten ladbar → nachteilig bei dynamischen Preisen',
    value: hasEVFlexibility ? 'Flexibel' : 'Fest'
  });
  
  // E3: > 70% Verbrauch in Peakzeiten
  const peakShare = derived.peakHourConsumption_pct;
  checks.push({
    id: 'not_excessive_peak',
    name: `Verbrauch in Peak-Zeiten ≤ 70% (aktuell: ${Math.round(peakShare)}%)`,
    section: 'exclusions',
    satisfied: peakShare <= THRESHOLDS.maxConsumptionInPeak_pct,
    importance: 'critical',
    reason: peakShare <= THRESHOLDS.maxConsumptionInPeak_pct
      ? `${Math.round(peakShare)}% vertretbar`
      : `${Math.round(peakShare)}% zu hoch → teure Zeiten unvermeidbar`,
    value: `${Math.round(peakShare)}%`
  });
  
  // E4: Jahresverbrauch ≥ 2000 kWh
  const annualCons = input.annualConsumption_kwh;
  checks.push({
    id: 'minimum_consumption',
    name: `Jahresverbrauch ≥ ${THRESHOLDS.minAnnualConsumption_kwh} kWh (aktuell: ${annualCons} kWh)`,
    section: 'exclusions',
    satisfied: annualCons >= THRESHOLDS.minAnnualConsumption_kwh,
    importance: 'critical',
    reason: annualCons >= THRESHOLDS.minAnnualConsumption_kwh
      ? `${annualCons} kWh → Economies of Scale`
      : `${annualCons} kWh → Einsparpotenzial zu klein`,
    value: `${annualCons} kWh`
  });
  
  // E5: Nutzer akzeptiert Kostenschwankungen
  checks.push({
    id: 'accepts_variable_costs',
    name: 'Nutzer akzeptiert variable Kosten',
    section: 'exclusions',
    satisfied: input.userAcceptsVariableCosts,
    importance: 'required',
    reason: input.userAcceptsVariableCosts
      ? 'Kostenschwankungen akzeptabel'
      : 'Feste Kosten gewünscht → statischer Tarif besser',
    value: input.userAcceptsVariableCosts ? 'Ja' : 'Nein'
  });
  
  return checks;
}

// ──────────────────────────────────────────────────────────────────────────────
/**
 * 5. WIRTSCHAFTLICHE SIMULATION
 */
// ──────────────────────────────────────────────────────────────────────────────

export interface EconomicComparison {
  staticCost_eur: number;
  dynamicCost_eur: number;
  savings_eur: number;
  savings_pct: number;
  recommendation: 'static' | 'dynamic';
}

/**
 * Vereinfachte wirtschaftliche Simulation
 * (Die genaue Berechnung erfolgt in calcService mit echter Tarifrechnung)
 */
export function estimateEconomicComparison(
  input: UserInputMetrics,
  avgSpotPrice_ct_kwh: number = 10,  // Fallback: 10 ct/kWh durchschnitt
  staticTariff_ct_kwh: number = 31,   // Fallback: 31 ct/kWh (2025-Durchschnitt)
  dynamicMarkupAndTaxes_ct_kwh: number = 4 // Aufschlag über Spotpreis
): EconomicComparison {
  const annualCons = input.annualConsumption_kwh;
  
  // Basis-Kosten ohne Speicher/PV
  const baseCost_static = (annualCons * staticTariff_ct_kwh) / 100;
  const baseCost_dynamic = (annualCons * (avgSpotPrice_ct_kwh + dynamicMarkupAndTaxes_ct_kwh)) / 100;
  
  // Vereinfachte Annahmen: speicherbare Last spart X%
  let staticCostAdjusted = baseCost_static;
  let dynamicCostAdjusted = baseCost_dynamic;
  
  // Mit PV: -10% dynamisch (bessere Optimierung)
  if (input.pvPowerKwp > 5) {
    dynamicCostAdjusted *= 0.90;
  }
  
  // Mit Speicher: -5% beide Tarife, aber dynamisch +2% (komplexere Steuerung)
  if (input.storageCapacityKwh > 3) {
    staticCostAdjusted *= 0.95;
    dynamicCostAdjusted *= 0.97;  // Speicher hilft dynamisch mehr
  }
  
  // Mit WP: -8% dynamisch (optimale Heizzeiten), -3% statisch
  if (input.hasHeatPump) {
    staticCostAdjusted *= 0.97;
    dynamicCostAdjusted *= 0.92;
  }
  
  // Mit EV: -6% dynamisch (optimale Ladezeiten)
  if (input.hasEV) {
    dynamicCostAdjusted *= 0.94;
  }
  
  const savings = staticCostAdjusted - dynamicCostAdjusted;
  const savings_pct = staticCostAdjusted > 0
    ? (savings / staticCostAdjusted) * 100
    : 0;
  
  let recommendation: 'static' | 'dynamic' = 'static';
  if (savings_pct >= THRESHOLDS.minSavingsForDynamic_pct) {
    recommendation = 'dynamic';
  } else if (savings_pct > THRESHOLDS.maxSavingsForStatic_pct) {
    // Dazwischen: Datenqualität zu unsicher → konservativ statisch
    recommendation = 'static';
  }
  
  return {
    staticCost_eur: Math.round(staticCostAdjusted * 100) / 100,
    dynamicCost_eur: Math.round(dynamicCostAdjusted * 100) / 100,
    savings_eur: Math.round(savings * 100) / 100,
    savings_pct: Math.round(savings_pct * 10) / 10,
    recommendation
  };
}

export function checkEconomicProfitability(
  economicComparison: EconomicComparison
): ConditionCheck[] {
  const checks: ConditionCheck[] = [];
  
  const savings_pct = economicComparison.savings_pct;
  const meetsThreshold = savings_pct >= THRESHOLDS.minSavingsForDynamic_pct;
  
  checks.push({
    id: 'economic_savings_threshold',
    name: `Mind. ${THRESHOLDS.minSavingsForDynamic_pct}% Kostenersparnis`,
    section: 'economic',
    satisfied: meetsThreshold,
    importance: 'critical',
    reason: meetsThreshold
      ? `${Math.round(savings_pct)}% Ersparnis: €${economicComparison.savings_eur}/Jahr`
      : savings_pct > THRESHOLDS.maxSavingsForStatic_pct
        ? `${Math.round(savings_pct)}% – Differenz zu klein für dynamisch`
        : `${Math.round(savings_pct)}% – Dynamisch günstiger, aber Datenqualität unsicher`,
    value: `${Math.round(savings_pct)}% (€${economicComparison.savings_eur}/a)`
  });
  
  return checks;
}

// ──────────────────────────────────────────────────────────────────────────────
/**
 * HAUPTFUNKTION: Vollständiger Eligibility-Check
 */
// ──────────────────────────────────────────────────────────────────────────────

export function assessDynamicTarifEligibility(
  input: UserInputMetrics,
  economicComparison: EconomicComparison,
  staticTariffCost_eur: number = 0,
  dynamicTariffCost_eur: number = 0
): DynamicTarifEligibilityReport {
  const derived = deriveMetrics(input);
  
  // Alle Bedingungsgruppen prüfen
  const requirements = checkMinimumRequirements(input, derived);
  const technical = checkTechnicalRequirements(input);
  const exclusions = checkExclusionRules(input, derived);
  const economic = checkEconomicProfitability(economicComparison);
  
  const allChecks = [...requirements, ...technical, ...exclusions, ...economic];
  
  // Bewertung nach Kategorien: "critical" muss erfüllt sein
  const requirementsMet = requirements
    .filter(c => c.importance === 'critical')
    .every(c => c.satisfied);
  
  const exclusionsOk = exclusions
    .filter(c => c.importance === 'critical')
    .every(c => c.satisfied);
  
  const technicalMet = technical.some(c => c.satisfied);  // Mind. eine technische Vorraussetzung
  
  const economicMet = economic
    .filter(c => c.importance === 'critical')
    .every(c => c.satisfied);
  
  // Gesamturteil
  const isEligibleForDynamic = requirementsMet && exclusionsOk && technicalMet && economicMet;
  
  // Empfehlung: nur "dynamic" wenn alle Bedingungen erfüllt UND wirtschaftlich sinnvoll
  let recommendedTariff: 'static' | 'dynamic' = 'static';
  if (isEligibleForDynamic && economicComparison.savings_pct >= THRESHOLDS.minSavingsForDynamic_pct) {
    recommendedTariff = 'dynamic';
  }
  
  // Verbale Begründung
  let mainReason = '';
  const detailedReasons: string[] = [];
  
  if (!requirementsMet) {
    const missing = requirements
      .filter(c => c.importance === 'critical' && !c.satisfied)
      .map(c => c.name);
    mainReason = `Nicht erfüllt: ${missing.join(', ')}`;
    detailedReasons.push(...missing.map(m => `❌ ${m}`));
  } else if (!exclusionsOk) {
    const violated = exclusions
      .filter(c => c.importance === 'critical' && !c.satisfied)
      .map(c => c.name);
    mainReason = `Ausschlussregeln greifen: ${violated.join(', ')}`;
    detailedReasons.push(...violated.map(v => `⚠️ ${v}`));
  } else if (!technicalMet) {
    mainReason = 'Keine technischen Voraussetzungen erfüllt (WP/EV/PV/Speicher)';
    detailedReasons.push('⚠️ Keine flexiblen Technologien vorhanden');
  } else if (!economicMet) {
    mainReason = `Zu geringe Kostenersparnis: nur ${Math.round(economicComparison.savings_pct)}% < ${THRESHOLDS.minSavingsForDynamic_pct}%`;
    detailedReasons.push(`💰 Ersparnis: €${economicComparison.savings_eur}/Jahr`);
  } else if (recommendedTariff === 'dynamic') {
    mainReason = `✅ Dynamisch empfohlen: €${economicComparison.savings_eur}/Jahr Ersparnis (${Math.round(economicComparison.savings_pct)}%)`;
    detailedReasons.push(`✅ Alle Bedingungen erfüllt`);
    detailedReasons.push(`✅ Klarer Kostenvorteil identifiziert`);
  } else {
    mainReason = `Statisch empfohlen: Ersparnis nur €${economicComparison.savings_eur}/Jahr (${Math.round(economicComparison.savings_pct)}%)`;
    detailedReasons.push('ℹ️ Zwar möglich, aber wirtschaftlich marginal');
  }
  
  return {
    recommendedTariff,
    isEligibleForDynamic,
    confidence: isEligibleForDynamic ? 'high' : economicMet && technicalMet ? 'medium' : 'low',
    checks: allChecks,
    requirementsMet,
    technicalMet,
    exclusionsOk,
    economicMet,
    estimatedStaticCost_eur: economicComparison.staticCost_eur,
    estimatedDynamicCost_eur: economicComparison.dynamicCost_eur,
    estimatedSavings_eur: economicComparison.savings_eur,
    estimatedSavings_pct: economicComparison.savings_pct,
    mainReason,
    detailedReasons,
  };
}
