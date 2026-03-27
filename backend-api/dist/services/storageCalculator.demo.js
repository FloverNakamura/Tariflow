"use strict";
/**
 * Test und Demonstration: SigEnergy Gewerbespeicher Dimensionierung
 *
 * Test-Szenario:
 * - Jahresverbrauch: 75.000 kWh
 * - Investitionskosten: 800 € pro kWh
 */
Object.defineProperty(exports, "__esModule", { value: true });
const storageCalculator_1 = require("./storageCalculator");
async function demonstrateStorageCalculation() {
    const calculator = new storageCalculator_1.StorageCalculator();
    // ========== INPUT-PARAMETER ==========
    const testInput = {
        annualConsumption_kwh: 75000,
        investmentCost_eur_per_kwh: 800,
        monthlyConsumption_kwh: 75000 / 12 // ~6.250 kWh/Monat
    };
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   SigEnergy Gewerbespeicher – Wirtschaftlichkeitsrechnung');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('📊 INPUT-PARAMETER:');
    console.log(`   Jahresverbrauch:           ${testInput.annualConsumption_kwh.toLocaleString('de-DE')} kWh`);
    console.log(`   Investitionskosten:        ${testInput.investmentCost_eur_per_kwh} €/kWh`);
    console.log(`   Durchschn. Monatlich:      ${testInput.monthlyConsumption_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh/Monat`);
    console.log(`   Fixpreis (SachsenEnergie): 0,27 €/kWh`);
    console.log(`   Spotpreis (Ø 2026):        0,12 €/kWh`);
    console.log(`   Arbitrage-Delta:           0,15 €/kWh\n`);
    // ========== BERECHNUNG ==========
    const result = calculator.calculate(testInput);
    console.log('✓ DIMENSIONIERUNG:');
    console.log(`   Tagesverbrauch:            ${result.dailyConsumption_kwh.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kWh/Tag`);
    console.log(`   Min. Speicher (30%):       ${result.storageSizing.min_kwh} kWh`);
    console.log(`   Max. Speicher (50%):       ${result.storageSizing.max_kwh} kWh`);
    console.log(`   ➜ EMPFOHLENE GRÖSSE:      ${result.storageSizing.recommended_kwh} kWh\n`);
    console.log('💰 WIRTSCHAFTLICHKEIT (pro Jahr):');
    console.log(`   Gesamtinvestition:         ${result.economics.totalInvestment_eur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`);
    console.log(`   Arbitrage-Ersparnis:       ${result.economics.arbitrageRevenue_eur_year.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`);
    console.log(`   Steuerlicher Vorteil:      ${result.economics.taxBenefit_eur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`);
    console.log(`   Gesamtbenefit/Jahr:        ${(result.economics.arbitrageRevenue_eur_year + result.economics.taxBenefit_eur).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`);
    console.log(`   ➜ AMORTISATIONSDAUER:      ${result.economics.paybackPeriod_years} Jahre`);
    console.log(`   ➜ ROI (Jahr 1):            ${result.economics.roi_percent_year}%\n`);
    console.log('🔋 PEAK SHAVING POTENZIAL:');
    if (result.peakShavingPotential.qualifiesForPeakShaving) {
        console.log(`   ✓ Qualifiziert für §14a StromNEV!`);
        console.log(`   Monatlicher Verbrauch:     ${result.peakShavingPotential.monthlyAvgConsumption_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh`);
        console.log(`   Threshold (8.300 kWh):     ÜBERSCHRITTEN`);
        if (result.peakShavingPotential.savingsFromPeakShaving_eur_year) {
            console.log(`   Zusätzliche Einsparung:    ${result.peakShavingPotential.savingsFromPeakShaving_eur_year.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`);
        }
    }
    else {
        console.log(`   ✗ Nicht qualifiziert (< 8.300 kWh/Monat)`);
        console.log(`   Monatlicher Verbrauch:     ${result.peakShavingPotential.monthlyAvgConsumption_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh`);
    }
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📋 ZUSAMMENFASSUNG:');
    console.log(`   Empfohlene Systemgröße:    ${result.storageSizing.recommended_kwh} kWh SigEnergy Speicher`);
    console.log(`   Gesamtinvestition:         ${result.economics.totalInvestment_eur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`);
    console.log(`   Jährlicher Nutzen:         ${(result.economics.arbitrageRevenue_eur_year + result.economics.taxBenefit_eur).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`);
    console.log(`   Amortisationsdauer:        ${result.economics.paybackPeriod_years} Jahre`);
    console.log('═══════════════════════════════════════════════════════════════\n');
}
// Starten
demonstrateStorageCalculation().catch(console.error);
