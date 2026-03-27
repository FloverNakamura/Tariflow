/**
 * SigEnergy Gewerbespeicher Wirtschaftlichkeitsrechnung
 * 
 * Berechnet die optimale Dimensionierung und Wirtschaftlichkeit
 * von gewerblichen Stromspeichersystemen basierend auf:
 * - Jahresverbrauch
 * - Arbitrage-Potenzial (Fix- vs. Spotpreis)
 * - Steuerliche Abschreibung (IAB)
 * - Peak Shaving Potenziale
 */

interface StorageCalculationInput {
  annualConsumption_kwh: number;        // Jahresverbrauch in kWh
  investmentCost_eur_per_kwh: number;   // Investitionskosten pro kWh
  monthlyConsumption_kwh?: number;      // Optional: Monatlicher Verbrauch für Peak-Shaving-Check
}

interface StorageCalculationResult {
  dailyConsumption_kwh: number;
  storageSizing: {
    min_kwh: number;
    max_kwh: number;
    recommended_kwh: number;
    recommended_size_index: number;  // Index in AVAILABLE_SIZES
  };
  economics: {
    totalInvestment_eur: number;
    arbitrageRevenue_eur_year: number;
    taxBenefit_eur: number;
    paybackPeriod_years: number;
    roi_percent_year: number;
  };
  peakShavingPotential: {
    qualifiesForPeakShaving: boolean;
    monthlyAvgConsumption_kwh: number;
    savingsFromPeakShaving_eur_year?: number;
  };
}

class StorageCalculator {
  // ========== KONSTANTEN ==========
  
  // Preise (ct/kWh brutto)
  private readonly FIX_PRICE_EUR_KWAH = 0.27;        // Sachsen Energy Fixpreis
  private readonly SPOT_PRICE_AVG_EUR_KWAH = 0.12;   // Durchschnittlicher Spotpreis 2026
  
  // Betriebsparameter
  private readonly DAILY_CYCLES = 1.5;               // Lade-/Entladzyklen pro Tag
  private readonly EFFICIENCY_ROUNDTRIP = 0.90;      // Rundengang-Wirkungsgrad (90%)
  
  // Steuerliche Parameter
  private readonly IAB_TAX_RATE = 0.35;              // Körperschaftsteuer + Gewerbesteuer
  private readonly IAB_DEDUCTION_BASE = 0.50;        // 50% AfA-Satz
  private readonly IAB_DEPRECIATION_YEARS = 10;      // Nutzungsdauer in Jahren
  
  // Netzentgelt-Schwellenwert (§14a StromNEV)
  private readonly RLM_THRESHOLD_MONTHLY = 8300;     // kWh pro Monat
  private readonly PEAK_SHAVING_REDUCTION_RATE = 0.15; // 15% Netzentgelt-Einsparung
  
  // Verfügbare Speichergröße in kWh
  private readonly AVAILABLE_SIZES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 54];

  /**
   * Hauptmethode: Berechne Wirtschaftlichkeit und optimale Speichergröße
   */
  calculate(input: StorageCalculationInput): StorageCalculationResult {
    // A) Tagesverbrauch berechnen
    const dailyConsumption = this.calculateDailyConsumption(input.annualConsumption_kwh);
    
    // B) Speicher-Dimensionierung
    const storageSizing = this.dimensionStorage(dailyConsumption);
    
    // C) Wirtschaftlichkeitsrechnung
    const totalInvestment = storageSizing.recommended_kwh * input.investmentCost_eur_per_kwh;
    const arbitrageRevenue = this.calculateArbitrageRevenue(storageSizing.recommended_kwh);
    const taxBenefit = this.calculateTaxBenefit(totalInvestment);
    const paybackPeriod = this.calculatePaybackPeriod(totalInvestment, arbitrageRevenue + taxBenefit);
    const roi = (arbitrageRevenue + taxBenefit) / totalInvestment * 100;
    
    // D) Peak Shaving Potenzial prüfen
    const monthlyAvgConsumption = input.annualConsumption_kwh / 12;
    const peakShavingPotential = this.checkPeakShavingPotential(
      input.monthlyConsumption_kwh || monthlyAvgConsumption,
      storageSizing.recommended_kwh,
      input.investmentCost_eur_per_kwh
    );
    
    return {
      dailyConsumption_kwh: dailyConsumption,
      storageSizing: storageSizing,
      economics: {
        totalInvestment_eur: parseFloat(totalInvestment.toFixed(2)),
        arbitrageRevenue_eur_year: parseFloat(arbitrageRevenue.toFixed(2)),
        taxBenefit_eur: parseFloat(taxBenefit.toFixed(2)),
        paybackPeriod_years: parseFloat(paybackPeriod.toFixed(2)),
        roi_percent_year: parseFloat(roi.toFixed(2))
      },
      peakShavingPotential: peakShavingPotential
    };
  }

  /**
   * A) Tagesverbrauch berechnen
   * Formel: E_Tag = Jahresverbrauch / 365
   */
  private calculateDailyConsumption(annualConsumption: number): number {
    return annualConsumption / 365;
  }

  /**
   * B) Speicher-Dimensionierung
   * Min: E_Tag × 0.3
   * Max: E_Tag × 0.5
   * Wähle nächsten Wert aus AVAILABLE_SIZES, der Max nicht überschreitet
   */
  private dimensionStorage(dailyConsumption: number): {
    min_kwh: number;
    max_kwh: number;
    recommended_kwh: number;
    recommended_size_index: number;
  } {
    const min = dailyConsumption * 0.3;
    const max = dailyConsumption * 0.5;
    
    // Finde beste Größe: Nächster Wert <= max, nicht über 54 kWh
    let recommended = this.AVAILABLE_SIZES[0];
    let recommendedIndex = 0;
    
    for (let i = 0; i < this.AVAILABLE_SIZES.length; i++) {
      if (this.AVAILABLE_SIZES[i] <= max) {
        recommended = this.AVAILABLE_SIZES[i];
        recommendedIndex = i;
      } else {
        break;
      }
    }
    
    return {
      min_kwh: parseFloat(min.toFixed(2)),
      max_kwh: parseFloat(max.toFixed(2)),
      recommended_kwh: recommended,
      recommended_size_index: recommendedIndex
    };
  }

  /**
   * C) Jährliche Arbitrage-Ersparnis
   * 
   * Formel: G_Arbitrage = S_gewählt × DAILY_CYCLES × EFFICIENCY × DELTA_PRICE × 365
   * 
   * Where:
   * - S_gewählt: Speichergröße in kWh
   * - DAILY_CYCLES: Anzahl vollständiger Lade-/Entladzyklen pro Tag (1.5)
   * - EFFICIENCY: Rundengang-Wirkungsgrad (90%)
   * - DELTA_PRICE: Differenz Fix- zu Spotpreis (0.27 - 0.12 = 0.15 €/kWh)
   */
  private calculateArbitrageRevenue(storageSize_kwh: number): number {
    const arbitrageDelta = this.FIX_PRICE_EUR_KWAH - this.SPOT_PRICE_AVG_EUR_KWAH;
    
    // Tägliche Arbitrage: Speichergröße × Zyklen × Effizienz × Preisdifferenz
    const dailyArbitrage = storageSize_kwh * this.DAILY_CYCLES * this.EFFICIENCY_ROUNDTRIP * arbitrageDelta;
    
    // Jahresarbitrage
    return dailyArbitrage * 365;
  }

  /**
   * D) Steuerlicher Vorteil über IAB (Instandhaltung, Alters- und Behindertengebot)
   * 
   * Formel: V_IAB = Investitionskosten × IAB_DEDUCTION_BASE × IAB_TAX_RATE
   * 
   * Vereinfachte Annahme: 50% Abschreibung im ersten Jahr
   * Effektive Steuerersparnis = Abschreibungsbasis × Steuersatz
   */
  private calculateTaxBenefit(investmentCost_eur: number): number {
    return investmentCost_eur * this.IAB_DEDUCTION_BASE * this.IAB_TAX_RATE;
  }

  /**
   * Amortisationsdauer berechnen (Payback Period)
   * Vereinfachte Annahme: lineare Amortisation über Jahre
   */
  private calculatePaybackPeriod(investment: number, annualBenefit: number): number {
    if (annualBenefit === 0) return Infinity;
    return investment / annualBenefit;
  }

  /**
   * E) Peak Shaving Potenzial prüfen
   * 
   * Wenn monatlicher Verbrauch > RLM_THRESHOLD_MONTHLY (8.300 kWh),
   * qualifiziert sich der Betrieb für §14a StromNEV (60% Netzentgelt-Reduktion).
   * 
   * Zusätzliche Einsparung durch gezieltes Peak Shaving:
   * - Reduzierung von Lastspitzen (Netzentgelt ca. 15% pro eingesparte kWh bei Spitzenlast)
   */
  private checkPeakShavingPotential(
    monthlyConsumption: number,
    storageSize_kwh: number,
    investmentCost_eur_per_kwh: number
  ): { 
    qualifiesForPeakShaving: boolean;
    monthlyAvgConsumption_kwh: number;
    savingsFromPeakShaving_eur_year?: number;
  } {
    const qualifies = monthlyConsumption > this.RLM_THRESHOLD_MONTHLY;
    
    let savingsFromPeakShaving = undefined;
    if (qualifies) {
      // Durchschnittliche Peak-Reduktion mit Speichergröße (in €/a)
      // Annahme: 2% des durchschnittlichen Netzentgelts pro kWh Speichergröße
      const estimatedNetzEntgelt_eur_per_kwh = 0.08; // Durchschnitt für Gewerbe
      savingsFromPeakShaving = 
        storageSize_kwh * this.PEAK_SHAVING_REDUCTION_RATE * estimatedNetzEntgelt_eur_per_kwh * 12;
    }
    
    return {
      qualifiesForPeakShaving: qualifies,
      monthlyAvgConsumption_kwh: parseFloat(monthlyConsumption.toFixed(2)),
      savingsFromPeakShaving_eur_year: savingsFromPeakShaving ? parseFloat(savingsFromPeakShaving.toFixed(2)) : undefined
    };
  }
}

export { StorageCalculator, StorageCalculationInput, StorageCalculationResult };

// ═══════════════════════════════════════════════════════════════════════════════
// PV-ANLAGE WIRTSCHAFTLICHKEITSRECHNUNG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Input für PV-Anlage (mit optionalem Speicher)
 */
interface PvCalculationInput {
  annualConsumption_kwh: number;           // Jahresverbrauch in kWh
  includeStorage?: boolean;               // Mit oder ohne Speicher (default: beide)
  storageInvestCost_eur_per_kwh?: number; // Investitionskosten Speicher (default: 800 €/kWh)
  storageSizeOverride_kwh?: number;       // Manuelle Speichergröße (sonst aus StorageCalc)
  pvSizeOverrideKwp?: number;             // Manuelle PV-Größe (sonst berechnet)
  coverageTarget?: number;               // Deckungsgrad (default 0.80 = 80%)
  discountRate?: number;                 // Kalkulationszinssatz für NPV (default 0.03 = 3%)
}

/**
 * Annual cashflow Jahr-für-Jahr
 */
interface AnnualCashflow {
  year: number;
  generation_kwh: number;
  selfConsumed_kwh: number;
  feedIn_kwh: number;
  savingsFromSelfConsumption_eur: number;
  feedInRevenue_eur: number;
  storageArbitrage_eur: number;
  omCost_eur: number;
  netBenefit_eur: number;
  cumulativeBenefit_eur: number;
  discountedCumulativeBenefit_eur: number;
}

/**
 * Vollständiges PV-Berechnungsergebnis
 */
interface PvCalculationResult {
  systemSizing: {
    recommended_kwp: number;
    recommended_rooftop_area_m2: number;  // Faustformel: ~7 m² pro kWp
    annual_yield_year1_kwh: number;
    coverage_percent: number;
    selfConsumption_kwh_year1: number;
    feedIn_kwh_year1: number;
    selfConsumptionRate_percent: number;
  };
  pricingBasis: {
    costPerKwp_eur: number;              // Installationskosten (Markt 2026)
    feedInTariff_ct_kwh: number;        // EEG Einspeisevergütung (BNetzA 2026)
    gridPrice_eur_kwh: number;          // Bezugspreis Sachsen Energy
    specificYield_kwh_per_kwp: number;  // Jahresertrag Deutschland-Ø
  };
  economics: {
    pvInvestment_eur: number;
    storageInvestment_eur: number;
    totalInvestment_eur: number;
    annualNetBenefit_eur_year1: number;   // Netto-Jahresertrag (ohne Steuer, Jahr 1)
    taxBenefitIAB_eur: number;            // IAB-Steuervorteil (Jahr 1, einmalig)
    annualOmCost_eur: number;
    simplePaybackYears: number;           // Amortisation ohne Steuereffekt
    paybackWithTaxYears: number;          // Amortisation mit IAB-Vorteil Jahr 1
    breakEvenYear: number;               // Kumulativer Break-Even-Zeitpunkt
    roi25Years_percent: number;           // Gesamtrendite über 25 Jahre
    npv25Years_eur: number;              // Nettobarwert (NPV) über 25 Jahre
  };
  storageBonus?: {
    extraSavings_eur_year: number;       // Mehrersparnis durch Speicher (vs. PV allein)
    selfConsumptionIncrease_percent: number;
    combinedPaybackYears: number;
  };
  cashflowByYear: AnnualCashflow[];      // Jahr-für-Jahr-Detail (25 Jahre)
}

type CombinedSystemResult = {
  pvOnly: PvCalculationResult;
  pvWithStorage: PvCalculationResult;
  recommendation: string;
}

/**
 * PV-Anlagen Wirtschaftlichkeitsrechner
 * Berechnet Rendite, Amortisation und Break-Even für gewerbliche PV-Anlagen
 * mit und ohne SigEnergy-Gewerbespeicher.
 *
 * Datengrundlage:
 * - EEG Einspeisevergütung: Bundesnetzagentur (März 2026)
 * - Jahresertrag: PVGIS 2.3 (Deutschland-Ø, Quelle: JRC/EU)
 * - Installationskosten: Marktdaten von Photovoltaik4all / EuPD Research 2026
 * - Eigenverbrauchsquoten: HTW Berlin Studie (Quaschning 2023)
 */
class PvCalculator {
  // ── EEG Einspeisevergütung 2026 (BNetzA, §48 EEG 2023, Gebäudeanlagen Teileinspeisung) ──
  // Quelle: https://www.bundesnetzagentur.de (stand März 2026)
  // Gilt für Inbetriebnahme ab Januar 2026
  private readonly EEG_FEED_IN_TIERS: { maxKwp: number; rate_ct_kwh: number }[] = [
    { maxKwp: 10,       rate_ct_kwh: 7.78 },   // bis 10 kWp: 7,78 ct/kWh
    { maxKwp: 40,       rate_ct_kwh: 6.73 },   // 10–40 kWp: 6,73 ct/kWh
    { maxKwp: 100,      rate_ct_kwh: 5.50 },   // 40–100 kWp: 5,50 ct/kWh
    { maxKwp: Infinity, rate_ct_kwh: 5.50 },   // > 100 kWp: ~5,50 ct/kWh
  ];

  // ── Installationskosten Gewerbe (Marktdaten 2026, EuPD Research / Photovoltaik4all) ──
  private readonly PV_COST_TIERS: { maxKwp: number; cost_eur_kwp: number }[] = [
    { maxKwp: 30,       cost_eur_kwp: 1_150 }, // <30 kWp: 1.150 €/kWp
    { maxKwp: 100,      cost_eur_kwp:   950 }, // 30–100 kWp: 950 €/kWp
    { maxKwp: Infinity, cost_eur_kwp:   750 }, // >100 kWp: 750 €/kWp
  ];

  // ── Betriebsparameter ──
  private readonly SPECIFIC_YIELD_KWH_KWP = 950;    // kWh/kWp/Jahr (PVGIS, DE-Ø)
  private readonly DEGRADATION_RATE = 0.005;         // 0,5 %/Jahr (IEC Norm)
  private readonly OM_COST_EUR_KWP_YEAR = 15;        // €/kWp/Jahr (ca. 1,5 % Investkosten)
  private readonly PV_LIFETIME_YEARS = 25;           // Systemlebensdauer
  private readonly ROOFTOP_M2_PER_KWP = 7;          // m² Dachfläche pro kWp (Faustformel)

  // ── Eigenverbrauchsquoten (HTW Berlin / Quaschning 2023) ──
  private readonly SELF_CONSUMPTION_WITHOUT_STORAGE = 0.30; // 30% direkte Eigenverbrauchsquote
  private readonly SELF_CONSUMPTION_WITH_STORAGE    = 0.70; // 70% mit optimiertem Speicher

  // ── Preise (geerbt aus StorageCalculator-Kontext) ──
  private readonly FIX_PRICE_EUR_KWH = 0.27;        // Sachsen Energy Fixpreis
  private readonly SPOT_PRICE_AVG_EUR_KWH = 0.12;   // Spotpreis-Ø 2026
  private readonly STORAGE_DAILY_CYCLES = 1.5;
  private readonly STORAGE_EFFICIENCY = 0.90;

  // ── Steuer ──
  private readonly IAB_DEDUCTION_BASE = 0.50;       // 50% AfA-Basis
  private readonly IAB_TAX_RATE = 0.35;             // KöSt + GewSt

  /**
   * Berechne PV-Wirtschaftlichkeit für beide Szenarien (ohne/mit Speicher)
   * und gib eine Empfehlung aus.
   */
  calculateCombined(input: PvCalculationInput): CombinedSystemResult {
    const pvOnly = this.calculate({ ...input, includeStorage: false });
    const pvWithStorage = this.calculate({ ...input, includeStorage: true });

    const delta = pvWithStorage.economics.npv25Years_eur - pvOnly.economics.npv25Years_eur;
    const recommendation =
      delta > 0
        ? `PV + Speicher empfohlen: Zusätzlicher NPV-Vorteil von ${Math.round(delta).toLocaleString('de-DE')} € über 25 Jahre.`
        : `PV alleine rechnet sich besser (NPV Δ ${Math.round(delta).toLocaleString('de-DE')} €). Speicher prüfen wenn Eigenverbrauch > 70 % gewünscht.`;

    return { pvOnly, pvWithStorage, recommendation };
  }

  /**
   * Kernberechnung PV (mit oder ohne Speicher)
   */
  calculate(input: PvCalculationInput): PvCalculationResult {
    const coverage = input.coverageTarget ?? 0.80;
    const discountRate = input.discountRate ?? 0.03;
    const withStorage = input.includeStorage ?? false;
    const storageInvestCost = input.storageInvestCost_eur_per_kwh ?? 800;

    // ── F) PV-Dimensionierung ──
    // P_PV = (Jahresverbrauch × Deckungsgrad) / spezifischer Jahresertrag
    const pvKwp = input.pvSizeOverrideKwp
      ?? parseFloat(((input.annualConsumption_kwh * coverage) / this.SPECIFIC_YIELD_KWH_KWP).toFixed(1));

    // Feed-in-Tariff nach Anlagengröße (BNetzA-Stufen)
    const feedInTariff_ct = this.getFeedInTariff(pvKwp);
    const feedInTariff_eur = feedInTariff_ct / 100;

    // Installationskosten nach Größenstufe (Markt 2026)
    const costPerKwp = this.getInstallCost(pvKwp);
    const pvInvestment = pvKwp * costPerKwp;

    // Speicher-Dimensionierung (aus StorageCalculator-Logik: 30–50% Tagesverbrauch)
    const dailyConsumption = input.annualConsumption_kwh / 365;
    const storageSizeKwh = input.storageSizeOverride_kwh
      ?? this.selectStorageSize(dailyConsumption * 0.5);
    const storageInvestment = withStorage ? storageSizeKwh * storageInvestCost : 0;
    const totalInvestment = pvInvestment + storageInvestment;

    // Eigenverbrauchsquote
    const selfConsumptionRate = withStorage
      ? this.SELF_CONSUMPTION_WITH_STORAGE
      : this.SELF_CONSUMPTION_WITHOUT_STORAGE;

    // ── G) Jahres-Cashflow über 25 Jahre ──
    const cashflowByYear: AnnualCashflow[] = [];
    let cumulativeBenefit = 0;
    let discountedCumulative = 0;
    let breakEvenYear = -1;
    const omCostYear = pvKwp * this.OM_COST_EUR_KWP_YEAR;

    for (let yr = 1; yr <= this.PV_LIFETIME_YEARS; yr++) {
      // Jährliche PV-Erzeugung mit Degradation: E_n = P_PV × ertrag × (1 - degradation)^(n-1)
      const generation = pvKwp * this.SPECIFIC_YIELD_KWH_KWP * Math.pow(1 - this.DEGRADATION_RATE, yr - 1);
      const selfConsumed = generation * selfConsumptionRate;
      const feedIn = generation * (1 - selfConsumptionRate);

      // Ersparnis durch Eigenverbrauch (Netzstrom wird nicht gekauft)
      const savingsFromSelfConsumption = selfConsumed * this.FIX_PRICE_EUR_KWH;

      // EEG-Einnahmen (feste 20-Jahr-Vergütung, danach 0 oder Marktprämie)
      const feedInRevenue = yr <= 20 ? feedIn * feedInTariff_eur : feedIn * (this.SPOT_PRICE_AVG_EUR_KWH * 0.8);

      // Speicher-Arbitrage (nur mit Speicher, Degradation analog 10 Jahre Nutzung)
      const storageDegradation = withStorage ? Math.pow(1 - 0.02, yr - 1) : 0; // 2%/Jahr LiFePO4
      const storageArbitrage = withStorage
        ? storageSizeKwh * this.STORAGE_DAILY_CYCLES * this.STORAGE_EFFICIENCY
          * (this.FIX_PRICE_EUR_KWH - this.SPOT_PRICE_AVG_EUR_KWH) * 365 * storageDegradation
        : 0;

      const netBenefit = savingsFromSelfConsumption + feedInRevenue + storageArbitrage - omCostYear;
      cumulativeBenefit += netBenefit;

      // Barwert-Diskontierung: BW_n = Nutzen_n / (1 + r)^n
      const discountFactor = Math.pow(1 + discountRate, yr);
      discountedCumulative += netBenefit / discountFactor;

      // Break-Even: Wann überschreitet kumulativer Nutzen die Gesamtinvestition?
      if (breakEvenYear === -1 && cumulativeBenefit >= totalInvestment) {
        breakEvenYear = yr;
      }

      cashflowByYear.push({
        year: yr,
        generation_kwh: parseFloat(generation.toFixed(0)),
        selfConsumed_kwh: parseFloat(selfConsumed.toFixed(0)),
        feedIn_kwh: parseFloat(feedIn.toFixed(0)),
        savingsFromSelfConsumption_eur: parseFloat(savingsFromSelfConsumption.toFixed(2)),
        feedInRevenue_eur: parseFloat(feedInRevenue.toFixed(2)),
        storageArbitrage_eur: parseFloat(storageArbitrage.toFixed(2)),
        omCost_eur: parseFloat(omCostYear.toFixed(2)),
        netBenefit_eur: parseFloat(netBenefit.toFixed(2)),
        cumulativeBenefit_eur: parseFloat(cumulativeBenefit.toFixed(2)),
        discountedCumulativeBenefit_eur: parseFloat(discountedCumulative.toFixed(2)),
      });
    }

    const year1 = cashflowByYear[0];
    const annualNetBenefitYear1 = year1.netBenefit_eur;

    // IAB Steuervorteil (einmalig Jahr 1)
    const taxBenefitIAB = totalInvestment * this.IAB_DEDUCTION_BASE * this.IAB_TAX_RATE;

    // Einfache Amortisationsdauer (ohne Steuer)
    const simplePayback = totalInvestment / annualNetBenefitYear1;

    // Amortisation mit IAB (Vorteil wird auf Investment angerechnet)
    const effectiveInvestmentAfterTax = totalInvestment - taxBenefitIAB;
    const paybackWithTax = effectiveInvestmentAfterTax / annualNetBenefitYear1;

    // Gesamtrendite über 25 Jahre
    const totalRevenue25 = cumulativeBenefit;
    const roi25 = ((totalRevenue25 - totalInvestment) / totalInvestment) * 100;

    // Nettobarwert (NPV)
    const npv25 = discountedCumulative - totalInvestment;

    // Speicher-Bonus (nur wenn Storage aktiv)
    let storageBonus = undefined;
    if (withStorage) {
      const extraSavings = year1.storageArbitrage_eur
        + (year1.selfConsumed_kwh - pvKwp * this.SPECIFIC_YIELD_KWH_KWP * this.SELF_CONSUMPTION_WITHOUT_STORAGE)
          * this.FIX_PRICE_EUR_KWH;
      storageBonus = {
        extraSavings_eur_year: parseFloat(extraSavings.toFixed(2)),
        selfConsumptionIncrease_percent: parseFloat(
          ((this.SELF_CONSUMPTION_WITH_STORAGE - this.SELF_CONSUMPTION_WITHOUT_STORAGE) * 100).toFixed(1)
        ),
        combinedPaybackYears: parseFloat(paybackWithTax.toFixed(2)),
      };
    }

    return {
      systemSizing: {
        recommended_kwp: pvKwp,
        recommended_rooftop_area_m2: Math.ceil(pvKwp * this.ROOFTOP_M2_PER_KWP),
        annual_yield_year1_kwh: parseFloat((pvKwp * this.SPECIFIC_YIELD_KWH_KWP).toFixed(0)),
        coverage_percent: parseFloat((coverage * 100).toFixed(1)),
        selfConsumption_kwh_year1: parseFloat(year1.selfConsumed_kwh.toString()),
        feedIn_kwh_year1: parseFloat(year1.feedIn_kwh.toString()),
        selfConsumptionRate_percent: selfConsumptionRate * 100,
      },
      pricingBasis: {
        costPerKwp_eur: costPerKwp,
        feedInTariff_ct_kwh: feedInTariff_ct,
        gridPrice_eur_kwh: this.FIX_PRICE_EUR_KWH,
        specificYield_kwh_per_kwp: this.SPECIFIC_YIELD_KWH_KWP,
      },
      economics: {
        pvInvestment_eur: parseFloat(pvInvestment.toFixed(2)),
        storageInvestment_eur: parseFloat(storageInvestment.toFixed(2)),
        totalInvestment_eur: parseFloat(totalInvestment.toFixed(2)),
        annualNetBenefit_eur_year1: parseFloat(annualNetBenefitYear1.toFixed(2)),
        taxBenefitIAB_eur: parseFloat(taxBenefitIAB.toFixed(2)),
        annualOmCost_eur: parseFloat(omCostYear.toFixed(2)),
        simplePaybackYears: parseFloat(simplePayback.toFixed(2)),
        paybackWithTaxYears: parseFloat(paybackWithTax.toFixed(2)),
        breakEvenYear: breakEvenYear > 0 ? breakEvenYear : -1,
        roi25Years_percent: parseFloat(roi25.toFixed(2)),
        npv25Years_eur: parseFloat(npv25.toFixed(2)),
      },
      storageBonus,
      cashflowByYear,
    };
  }

  /**
   * F) EEG-Einspeisevergütung nach Anlagengröße (BNetzA 2026, §48 EEG)
   * Gibt ct/kWh zurück
   */
  private getFeedInTariff(pvKwp: number): number {
    for (const tier of this.EEG_FEED_IN_TIERS) {
      if (pvKwp <= tier.maxKwp) return tier.rate_ct_kwh;
    }
    return this.EEG_FEED_IN_TIERS[this.EEG_FEED_IN_TIERS.length - 1].rate_ct_kwh;
  }

  /**
   * G) Installationskosten nach Anlagengröße (Markt 2026)
   * Gibt €/kWp zurück
   */
  private getInstallCost(pvKwp: number): number {
    for (const tier of this.PV_COST_TIERS) {
      if (pvKwp <= tier.maxKwp) return tier.cost_eur_kwp;
    }
    return this.PV_COST_TIERS[this.PV_COST_TIERS.length - 1].cost_eur_kwp;
  }

  /**
   * Speichergröße aus AVAILABLE_SIZES wählen (analog StorageCalculator)
   */
  private selectStorageSize(maxSize: number): number {
    const AVAILABLE_SIZES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 54];
    let selected = AVAILABLE_SIZES[0];
    for (const size of AVAILABLE_SIZES) {
      if (size <= maxSize) selected = size;
      else break;
    }
    return selected;
  }
}

export {
  PvCalculator,
  PvCalculationInput,
  PvCalculationResult,
  CombinedSystemResult,
  AnnualCashflow,
};
