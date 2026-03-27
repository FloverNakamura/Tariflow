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
