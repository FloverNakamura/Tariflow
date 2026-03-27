# SigEnergy Gewerbespeicher – Dimensionierungsrechner

## 📋 Überblick

Präzises Berechnungs-Modul zur wirtschaftlichen Dimensionierung von [SigEnergy](https://www.sigenergy.de/)-Gewerbespeichern. Berechnet automatisch:

- **Optimale Speichergröße** basierend auf Jahresverbrauch
- **Jährliche Arbitrage-Ersparnis** (Fix- vs. Spotpreis-Differenzial)
- **Steuerliche Vorteile** (IAB-Abschreibung)
- **Amortisationsdauer & ROI**
- **Peak-Shaving-Potenziale** (§14a StromNEV-Qualification)

---

## 🔧 Konstanten & Marktparameter (März 2026)

| Parameter | Wert | Quelle |
|-----------|------|--------|
| **Fixpreis** | 0,27 €/kWh | Sachsen Energy (brutto) |
| **Spotpreis-Ø** | 0,12 €/kWh | EPEX SPOT 2026 |
| **Arbitrage-Delta** | 0,15 €/kWh | FIX - SPOT |
| **Daily Cycles** | 1,5 | Realistische Nutzung |
| **Rundgangswirkungsgrad** | 90% | LiFePO₄-Speicher |
| **IAB-Steuersatz** | 35% | KöSt + Gewerbesteuer |
| **IAB-AfA-Satz** | 50% | Abschreibungsbasis Jahr 1 |
| **RLM-Schwellenwert** | 8.300 kWh/Mo | §14a StromNEV |

---

## 📦 Verfügbare SigEnergy-Speichergrößen

```
[10, 15, 20, 25, 30, 35, 40, 45, 50, 54] kWh
```

Alle Größen sind modular kombinierbar. Der Rechner optimiert die Auswahl basierend auf Tagesverbrauch (30–50%-Range).

---

## 🎯 Berechnungslogik

### A) Tagesverbrauch  
```
E_Tag = Jahresverbrauch / 365
```

### B) Dimensionierungsbereich
```
S_min = E_Tag × 0,3
S_max = E_Tag × 0,5
Empfehlung: Größe aus AVAILABLE_SIZES ≤ S_max
```

### C) Jährliche Arbitrage-Ersparnis
```
G_Arbitrage = S_gewählt × DAILY_CYCLES × EFFICIENCY × (FIX_PRICE - SPOT_PRICE) × 365

Beispiel (54 kWh):
= 54 × 1,5 × 0,90 × 0,15 × 365
= 3.991,28 €/Jahr
```

### D) Steuerlicher Vorteil
```
V_IAB = Investitionskosten × 0,50 × 0,35

Beispiel (43.200 € Investition):
= 43.200 × 0,50 × 0,35
= 7.560 €
```

### E) Peak-Shaving-Check
- ✓ Qualifiziert: Monatlich > 8.300 kWh → §14a-Reduktion (60% Netzentgelt)
- ✗ Nicht qualifiziert: Monatlich ≤ 8.300 kWh → Keine Reduktion

---

## 🚀 API-Endpoints

### 1. POST `/api/storage/calculate`

Berechnet optimale Speichergröße und Wirtschaftlichkeit.

**Request:**
```json
{
  "annualConsumption_kwh": 75000,
  "investmentCost_eur_per_kwh": 800,
  "monthlyConsumption_kwh": 6250
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "dailyConsumption_kwh": 205.48,
    "storageSizing": {
      "min_kwh": 61.64,
      "max_kwh": 102.74,
      "recommended_kwh": 54,
      "recommended_size_index": 9
    },
    "economics": {
      "totalInvestment_eur": 43200.00,
      "arbitrageRevenue_eur_year": 3991.28,
      "taxBenefit_eur": 7560.00,
      "paybackPeriod_years": 3.74,
      "roi_percent_year": 26.74
    },
    "peakShavingPotential": {
      "qualifiesForPeakShaving": false,
      "monthlyAvgConsumption_kwh": 6250.00
    }
  }
}
```

---

### 2. GET `/api/storage/info`

Gibt Informationen über verfügbare Speichergrößen und Konstanten.

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "SigEnergy Gewerbespeicher Dimensionierungsrechner",
    "version": "1.0.0",
    "availableSizes": [10, 15, 20, 25, 30, 35, 40, 45, 50, 54],
    "constants": {
      "fixPrice_eur_kwh": 0.27,
      "spotPrice_avg_eur_kwh": 0.12,
      "arbitrageDelta_eur_kwh": 0.15,
      "daily_cycles": 1.5,
      "efficiency_roundtrip": 0.90,
      "iab_tax_rate": 0.35,
      "iab_deduction_base": 0.50,
      "rlm_threshold_monthly_kwh": 8300
    }
  }
}
```

---

## 📝 Beispiel-Szenario: 75.000 kWh Jahresverbrauch

### Input:
- **Jahresverbrauch**: 75.000 kWh
- **Investitionskosten**: 800 €/kWh  
- **Monatlicher Ø**: 6.250 kWh

### Berechnung:

| Schritt | Berechnung | Ergebnis |
|---------|-----------|---------|
| **A) Tagesverbrauch** | 75.000 / 365 | 205,48 kWh/Tag |
| **B) Min/Max** | Min: 61,64 / Max: 102,74 | → **Empfehlung: 54 kWh** |
| **C) Investition total** | 54 × 800 | **43.200,00 €** |
| **D) Jährliche Arbitrage** | 54 × 1,5 × 0,9 × 0,15 × 365 | **3.991,28 €** |
| **E) Steuerlicher Vorteil** | 43.200 × 0,5 × 0,35 | **7.560,00 €** |
| **Gesamtbenefit/Jahr** | 3.991,28 + 7.560,00 | **11.551,28 €** |
| **Amortisationsdauer** | 43.200 / 11.551,28 | **3,74 Jahre** |
| **ROI (Jahr 1)** | (11.551,28 / 43.200) × 100 | **26,74%** |
| **Peak Shaving** | 6.250 < 8.300 | ✗ Nicht qualifiziert |

### 📊 Output:
```
Empfohlen: 54 kWh SigEnergy Speicher
Gesamtinvestition: 43.200,00 €
Jährlicher Nutzen: 11.551,28 €
Amortisationsdauer: 3,74 Jahre
```

---

## 💻 Verwendung im Code

### TypeScript/Node.js:

```typescript
import { StorageCalculator } from './services/storageCalculator';

const calculator = new StorageCalculator();

const result = calculator.calculate({
  annualConsumption_kwh: 75_000,
  investmentCost_eur_per_kwh: 800,
  monthlyConsumption_kwh: 6_250
});

console.log(`Empfohlen: ${result.storageSizing.recommended_kwh} kWh`);
console.log(`Amortisationsdauer: ${result.economics.paybackPeriod_years} Jahre`);
```

### cURL:

```bash
curl -X POST http://localhost:3001/api/storage/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "annualConsumption_kwh": 75000,
    "investmentCost_eur_per_kwh": 800,
    "monthlyConsumption_kwh": 6250
  }'
```

---

## 🔬 Mathematische Details

### Arbitrage (Kauf bei Spotpreis, Verkauf bei Fixpreis):

```
Tägliche Arbitrage = Speicher × Zyklen × Effizienz × ΔPreis
                   = 54 kWh × 1,5 × 0,90 × 0,15 €/kWh
                   = 10,935 €/Tag
                   = 3.991,28 €/Jahr
```

### Steuerliche IAB-Abschreibung:

- Gewerbe-Speicher qualifizieren für **50% Abschreibung** im ersten Jahr
- Effektive Steuerersparnis: Abschreibung × Steuersatz (35%)
- Im Beispiel: 43.200 € × 0,5 × 0,35 = **7.560 €uro**

### Peak-Shaving (§14a StromNEV):

Betriebe mit > 8.300 kWh Monatlicher Entnahme erhalten:
- **60% Reduktion** auf Netzentgelte
- Zusätzlich ~15% Einsparung durch Lastspitzen-Reduktion
- Speichert während günstiger Zeiten, entlädt bei Spitzenlast

---

## 🔄 Iterationen & Marktentwicklung

Die Konstanten basieren auf März 2026 Marktdaten:

```json
{
  "lastUpdate": "2026-03-27",
  "source": "EPEX SPOT, SachsenEnergie, Steuerrechnung",
  "notes": "Spotpreise sind volatil; use annual averages"
}
```

**Regelmäßige Aktualisierungen empfohlen für:**
- Aktuelle Spotpreis-Durchschnitte (monatlich)
- Steuerliche Änderungen (jährlich)  
- RLM-Schwellenwerte (bei Änderungen)

---

## 📄 Dateien

| Datei | Zweck |
|-------|-------|
| `src/services/storageCalculator.ts` | Hauptmodul mit StorageCalculator-Klasse |
| `src/routes/storageRoutes.ts` | Express API-Endpoints |
| `src/services/storageCalculator.demo.ts` | CLI-Demo mit Test-Szenario |

---

## 🧪 Unit Tests

Starten Sie die Demo:

```bash
npm run build
npx ts-node src/services/storageCalculator.demo.ts
```

Erwartet Ausgang für 75.000 kWh-Jahresverbrauch:
- ✓ Empfohlen: 54 kWh
- ✓ Amortisationsdauer: ~3,7 Jahre
- ✓ ROI: ~27%

---

## 📞 Support & Kontakt

- **Code**: [services/storageCalculator.ts](./src/services/storageCalculator.ts)
- **API**: [routes/storageRoutes.ts](./src/routes/storageRoutes.ts)
- **Demo**: Führe CLI-Demo mit `ts-node src/services/storageCalculator.demo.ts` aus

---

**Version 1.0.0** | Letzte Aktualisierung: 27. März 2026
