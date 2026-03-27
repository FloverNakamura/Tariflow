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
function fmt(eur) {
    return eur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
async function demonstratePvCalculation() {
    const pvCalc = new storageCalculator_1.PvCalculator();
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   PV-Anlage + Speicher – Vergleichsrechnung');
    console.log('   Jahresverbrauch: 75.000 kWh | Speicher: 800 €/kWh');
    console.log('═══════════════════════════════════════════════════════════════\n');
    const combined = pvCalc.calculateCombined({
        annualConsumption_kwh: 75000,
        storageInvestCost_eur_per_kwh: 800,
        coverageTarget: 0.80,
        discountRate: 0.03,
    });
    for (const [label, data] of [
        ['PV ALLEINE (ohne Speicher)', combined.pvOnly],
        ['PV + SPEICHER (kombiniert)', combined.pvWithStorage],
    ]) {
        const d = data;
        console.log(`── ${label} ${'─'.repeat(43 - label.length)}`);
        console.log(`   PV-Anlage:                 ${d.systemSizing.recommended_kwp} kWp`);
        console.log(`   Benötigte Dachfläche:      ${d.systemSizing.recommended_rooftop_area_m2} m²`);
        console.log(`   Jahresertrag (Jahr 1):     ${d.systemSizing.annual_yield_year1_kwh.toLocaleString('de-DE')} kWh`);
        console.log(`   Eigenverbrauchsquote:      ${d.systemSizing.selfConsumptionRate_percent}%`);
        console.log(`   Eigenverbrauch (Jahr 1):   ${d.systemSizing.selfConsumption_kwh_year1.toLocaleString('de-DE')} kWh`);
        console.log(`   Einspeisung (Jahr 1):      ${d.systemSizing.feedIn_kwh_year1.toLocaleString('de-DE')} kWh`);
        console.log(`   EEG-Vergütung:             ${d.pricingBasis.feedInTariff_ct_kwh} ct/kWh (BNetzA 2026)`);
        console.log(`   Kosten/kWp:                ${d.pricingBasis.costPerKwp_eur} €/kWp (Markt 2026)`);
        console.log();
        console.log(`   PV-Investition:            ${fmt(d.economics.pvInvestment_eur)}`);
        console.log(`   Speicher-Investition:      ${fmt(d.economics.storageInvestment_eur)}`);
        console.log(`   Gesamt-Investition:        ${fmt(d.economics.totalInvestment_eur)}`);
        console.log(`   IAB-Steuervorteil:         ${fmt(d.economics.taxBenefitIAB_eur)}`);
        console.log(`   Netto-Jahresertrag (J.1):  ${fmt(d.economics.annualNetBenefit_eur_year1)}`);
        console.log(`   Wartungskosten/Jahr:       ${fmt(d.economics.annualOmCost_eur)}`);
        console.log();
        console.log(`   ➜ Amortisation (einfach):  ${d.economics.simplePaybackYears} Jahre`);
        console.log(`   ➜ Amortisation (mit IAB):  ${d.economics.paybackWithTaxYears} Jahre`);
        console.log(`   ➜ Break-Even-Jahr:         Jahr ${d.economics.breakEvenYear}`);
        console.log(`   ➜ Gesamtrendite 25 Jahre:  ${d.economics.roi25Years_percent}%`);
        console.log(`   ➜ NPV 25 Jahre (3%):       ${fmt(d.economics.npv25Years_eur)}`);
        console.log();
    }
    console.log('── EMPFEHLUNG ──────────────────────────────────────────────────');
    console.log(`   ${combined.recommendation}`);
    console.log();
    // Cashflow-Tabelle (erste 10 Jahre)
    console.log('── CASHFLOW-DETAIL (PV + Speicher, Jahre 1–10) ─────────────────');
    console.log('   Jahr  Erzeugung  Eigenverbr.  Einspeise-Rev.  Speicher-Arb.  Netto/Jahr  Kumulativ');
    for (const yr of combined.pvWithStorage.cashflowByYear.slice(0, 10)) {
        const row = [
            String(yr.year).padStart(5),
            String(yr.generation_kwh.toLocaleString('de-DE')).padStart(9) + ' kWh',
            String(yr.selfConsumed_kwh.toLocaleString('de-DE')).padStart(7) + ' kWh',
            fmt(yr.feedInRevenue_eur).padStart(12),
            fmt(yr.storageArbitrage_eur).padStart(12),
            fmt(yr.netBenefit_eur).padStart(10),
            fmt(yr.cumulativeBenefit_eur).padStart(12),
        ].join('  ');
        console.log(`   ${row}`);
    }
    console.log('\n═══════════════════════════════════════════════════════════════\n');
}
// Starten
demonstrateStorageCalculation()
    .then(() => demonstratePvCalculation())
    .catch(console.error);
