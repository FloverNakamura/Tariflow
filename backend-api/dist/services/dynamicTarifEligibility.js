"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDynamicTarifEligibilityReport = createDynamicTarifEligibilityReport;
function pct(value) {
    return Number((value * 100).toFixed(2));
}
function round(value) {
    return Number(value.toFixed(2));
}
function check(id, name, section, satisfied, importance, reason, value) {
    return { id, name, section, satisfied, importance, reason, value };
}
function createDynamicTarifEligibilityReport(input) {
    const checks = [];
    const annualConsumption = Math.max(0, input.annualConsumptionKwh);
    const gridDraw = Math.max(0, input.annualGridDrawKwh);
    const flexibilityRatio = annualConsumption > 0
        ? (Number(input.hasStorage) * 0.45 + Number(input.hasEv) * 0.35 + Number(input.hasHeatPump) * 0.2)
        : 0;
    checks.push(check('req_consumption_floor', 'Ausreichender Jahresverbrauch', 'requirements', annualConsumption >= 2500, 'required', annualConsumption >= 2500
        ? 'Verbrauch liegt in einem Bereich, in dem Preiszeitfenster relevant sind.'
        : 'Bei sehr niedrigem Verbrauch ist der dynamische Mehrwert oft zu klein.', round(annualConsumption)));
    checks.push(check('tech_smart_meter_assumption', 'Smart-Meter / Lastverschiebung technisch moeglich', 'technical', input.dynamicOptimization || input.hasStorage || input.hasEv, 'required', input.dynamicOptimization || input.hasStorage || input.hasEv
        ? 'Technische Flexibilitaet fuer zeitvariable Preise ist vorhanden.'
        : 'Ohne Flexibilitaet wird ein dynamischer Tarif oft nicht ausgenutzt.', input.dynamicOptimization || input.hasStorage || input.hasEv));
    checks.push(check('tech_price_spread', 'Ausreichende Marktpreis-Spreizung', 'technical', input.dynamicSpreadCtPerKwh >= 6, 'required', input.dynamicSpreadCtPerKwh >= 6
        ? 'Die Spotpreisspreizung ist gross genug fuer Optimierung.'
        : 'Geringe Spotpreisspreizung reduziert das Einsparpotenzial.', round(input.dynamicSpreadCtPerKwh)));
    checks.push(check('rec_storage_buffer', 'Speicher als Puffer', 'technical', !input.hasStorage || input.storageCapacityKwh >= 4, 'recommended', input.hasStorage
        ? 'Speicherkapazitaet unterstuetzt Lastverschiebung.'
        : 'Auch ohne Speicher moeglich, aber mit weniger Optimierungsspielraum.', round(input.storageCapacityKwh)));
    checks.push(check('exc_low_grid_draw', 'Nicht zu niedriger Netzbezug', 'exclusions', gridDraw >= 800, 'required', gridDraw >= 800
        ? 'Es bleibt genug netzseitiger Energieanteil fuer Tarifoptimierung.'
        : 'Sehr niedriger Netzbezug begrenzt den Effekt von Tarifwechseln.', round(gridDraw)));
    const estimatedSavings = input.staticNetCostEur - input.dynamicNetCostEur;
    checks.push(check('eco_cost_advantage', 'Wirtschaftlicher Vorteil', 'economic', estimatedSavings > 0, 'critical', estimatedSavings > 0
        ? 'Dynamischer Tarif ist im Modell guenstiger.'
        : 'Kein Kostenvorteil gegenueber statischem Tarif.', round(estimatedSavings)));
    const requirementsMet = checks
        .filter((entry) => entry.section === 'requirements' && entry.importance !== 'recommended')
        .every((entry) => entry.satisfied);
    const technicalMet = checks
        .filter((entry) => entry.section === 'technical' && entry.importance !== 'recommended')
        .every((entry) => entry.satisfied);
    const exclusionsOk = checks
        .filter((entry) => entry.section === 'exclusions' && entry.importance !== 'recommended')
        .every((entry) => entry.satisfied);
    const economicMet = checks
        .filter((entry) => entry.section === 'economic' && entry.importance !== 'recommended')
        .every((entry) => entry.satisfied);
    const isEligible = requirementsMet && technicalMet && exclusionsOk && economicMet;
    const savingsPct = input.staticNetCostEur > 0 ? estimatedSavings / input.staticNetCostEur : 0;
    const confidence = isEligible
        ? (input.dynamicSpreadCtPerKwh >= 8 && flexibilityRatio >= 0.45 ? 'high' : 'medium')
        : (economicMet ? 'medium' : 'low');
    const detailedReasons = checks
        .filter((entry) => !entry.satisfied || entry.importance === 'critical')
        .map((entry) => `${entry.name}: ${entry.reason}`);
    return {
        recommendedTariff: isEligible ? 'dynamic' : 'static',
        isEligibleForDynamic: isEligible,
        confidence,
        checks,
        requirementsMet,
        technicalMet,
        exclusionsOk,
        economicMet,
        estimatedStaticCost_eur: round(input.staticNetCostEur),
        estimatedDynamicCost_eur: round(input.dynamicNetCostEur),
        estimatedSavings_eur: round(estimatedSavings),
        estimatedSavings_pct: pct(savingsPct),
        mainReason: isEligible
            ? 'Dynamischer Tarif zeigt in dieser Konfiguration einen wirtschaftlichen Vorteil.'
            : 'Statischer Tarif bleibt in dieser Konfiguration wirtschaftlich robuster.',
        detailedReasons,
    };
}
