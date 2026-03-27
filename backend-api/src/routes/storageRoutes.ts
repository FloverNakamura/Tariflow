import { Router, Request, Response } from 'express';
import { StorageCalculator } from '../services/storageCalculator';

const router = Router();

/**
 * POST /storage/calculate
 * 
 * Berechnet die optimale Dimensionierung und Wirtschaftlichkeit 
 * von SigEnergy-Gewerbespeichern basierend auf Jahresverbrauch und Investitionskosten.
 * 
 * Request Body:
 * {
 *   "annualConsumption_kwh": 75000,      // Jahresverbrauch in kWh
 *   "investmentCost_eur_per_kwh": 800,   // Investitionskosten pro kWh
 *   "monthlyConsumption_kwh": 6250       // Optional: Monatlicher Verbrauch (für Peak-Shaving-Check)
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "dailyConsumption_kwh": 205.48,
 *     "storageSizing": {...},
 *     "economics": {...},
 *     "peakShavingPotential": {...}
 *   }
 * }
 */
router.post('/calculate', (req: Request, res: Response) => {
  try {
    const { annualConsumption_kwh, investmentCost_eur_per_kwh, monthlyConsumption_kwh } = req.body;
    
    // Validierung
    if (!annualConsumption_kwh || !investmentCost_eur_per_kwh) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: annualConsumption_kwh, investmentCost_eur_per_kwh'
      });
    }
    
    if (annualConsumption_kwh <= 0 || investmentCost_eur_per_kwh <= 0) {
      return res.status(400).json({
        success: false,
        error: 'annualConsumption_kwh and investmentCost_eur_per_kwh must be positive numbers'
      });
    }
    
    // Berechnung
    const calculator = new StorageCalculator();
    const result = calculator.calculate({
      annualConsumption_kwh,
      investmentCost_eur_per_kwh,
      monthlyConsumption_kwh
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('[StorageRouter] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during storage calculation'
    });
  }
});

/**
 * GET /storage/info
 * 
 * Returns information about the storage calculator constants and parameters.
 */
router.get('/info', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      name: 'SigEnergy Gewerbespeicher Dimensionierungsrechner',
      version: '1.0.0',
      availableSizes: [10, 15, 20, 25, 30, 35, 40, 45, 50, 54],
      constants: {
        fixPrice_eur_kwh: 0.27,
        spotPrice_avg_eur_kwh: 0.12,
        arbitrageDelta_eur_kwh: 0.15,
        daily_cycles: 1.5,
        efficiency_roundtrip: 0.90,
        iab_tax_rate: 0.35,
        iab_deduction_base: 0.50,
        rlm_threshold_monthly_kwh: 8300
      },
      description: 'Optimiert die Speichergröße für Gewerbekunden und berechnet Amortisationsdauer, ROI und Peak-Shaving-Potenziale'
    }
  });
});

export default router;
