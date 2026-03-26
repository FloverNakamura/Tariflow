const LOCAL_API_BASES = [
  'http://localhost:3001/api',
  'http://127.0.0.1:3001/api'
];
const SAME_ORIGIN_API_BASE = '/api';

function getApiCandidates() {
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  // Local Live Server should prefer the local Express backend.
  const port = window.location.port;
  const isNetlifyDev = host === 'localhost' && (port === '8888' || port === '8889');
  const candidates = isNetlifyDev
    ? [SAME_ORIGIN_API_BASE, ...LOCAL_API_BASES]
    : isLocalHost
      ? [...LOCAL_API_BASES, SAME_ORIGIN_API_BASE]
      : [SAME_ORIGIN_API_BASE, ...LOCAL_API_BASES];

  // Keep order but avoid duplicates.
  return [...new Set(candidates)];
}

async function apiFetch(path, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 8000;
  const { timeoutMs: _ignoreTimeout, ...fetchOptions } = options;
  const candidates = getApiCandidates();
  let lastError = null;

  for (const base of candidates) {
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timeoutId = timeoutMs > 0
      ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
      : null;

    let externalAbortHandler = null;
    if (fetchOptions.signal) {
      if (fetchOptions.signal.aborted) {
        controller.abort(fetchOptions.signal.reason);
      } else {
        externalAbortHandler = () => controller.abort(fetchOptions.signal.reason);
        fetchOptions.signal.addEventListener('abort', externalAbortHandler, { once: true });
      }
    }

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      if (timeoutId) clearTimeout(timeoutId);
      if (externalAbortHandler) {
        fetchOptions.signal.removeEventListener('abort', externalAbortHandler);
      }

      if (response.ok) {
        return { response, base };
      }

      lastError = new Error(`HTTP ${response.status} via ${base}`);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalAbortHandler) {
        fetchOptions.signal.removeEventListener('abort', externalAbortHandler);
      }
      if (error?.name === 'AbortError') {
        lastError = new Error(`Timeout nach ${timeoutMs}ms via ${base}`);
      } else {
        lastError = error;
      }
    }
  }

  throw (lastError || new Error('API nicht erreichbar.'));
}

const byId = (id) => document.getElementById(id);

const form = byId('calcForm');
const calcBtn = byId('calcBtn');
const btnLabel = byId('btnLabel');
const btnLoading = byId('btnLoading');
const errorBox = byId('errorBox');
const successBox = byId('successBox');
const resultsSection = byId('resultsSection');
const energyResultsSection = byId('energyResultsSection');
const exportBtn = byId('exportBtn');
const apiStatus = byId('apiStatus');
const marketTickerRefresh = byId('marketTickerRefresh');
const marketTickerCurrent = byId('marketTickerCurrent');
const marketTickerDynamicCurrent = byId('marketTickerDynamicCurrent');
const marketTickerTrend = byId('marketTickerTrend');
const marketTickerWindow = byId('marketTickerWindow');
const marketTickerStatus = byId('marketTickerStatus');
const wizardStage = byId('wizardStage');
const wizardPrev = byId('wizardPrev');
const wizardNext = byId('wizardNext');
const wizardStepLabel = byId('wizardStepLabel');
const wizardStepTitle = byId('wizardStepTitle');
const wizardProgressFill = byId('wizardProgressFill');
const installedBefore2024 = byId('installedBefore2024');
const allowsGridControl = byId('allowsGridControl');
const moduleConditionBlock = byId('moduleConditionBlock');
const controlConsentBlock = byId('controlConsentBlock');
const consumptionChoiceBlock = byId('consumptionChoiceBlock');
const moduleConsumptionPattern = byId('moduleConsumptionPattern');
const moduleDecisionResult = byId('moduleDecisionResult');

let latestData = null;
let monthlyChart = null;
let balanceChart = null;
let marketTickerTimer = null;
let marketTickerSamples = [];
let marketTickerBusy = false;
let marketTickerHistoryLoaded = false;

const MARKET_TICKER_SAMPLE_LIMIT = 120;
const MARKET_TICKER_HISTORY_HOURS = 168;
const MARKET_TICKER_INTERVAL_MS = 60 * 60 * 1000;
const MARKET_TICKER_SYNC_DELAY_MS = 1500;
const WIZARD_ANIMATION_MS = 360;

const wizardState = {
  steps: [],
  currentIndex: 0
};

let wizardResizeObserver = null;
let wizardMutationObserver = null;

// ─── Info-Texte ─────────────────────────────────────────────────────────────
const INFO_TEXTS = {
  plz: {
    title: 'Postleitzahl (PLZ)',
    html: `<p>Die PLZ wird genutzt, um den geografischen Standort des Haushalts zu bestimmen.
           Intern wird die PLZ einer Koordinate (Breitengrad, Längengrad) zugeordnet.</p>
           <p>Diese Koordinaten fließen direkt in die Berechnung des <strong>PV-Ertrags</strong> ein:
           Je weiter südlich der Standort, desto höher die Sonneneinstrahlung und damit der jährliche Solarertrag.</p>
           <div class="formula">Einstrahlungskorrektur = f(Breitengrad) × saisonale Lastprofile</div>`
  },
  persons: {
    title: 'Personenzahl',
    html: `<p>Die Personenzahl bestimmt den <strong>Jahresstromverbrauch</strong> des Haushalts
           anhand der BDEW-Standardlastkurve (Haushaltstyp H0):</p>
           <ul>
             <li>1 Person: ca. <strong>1.500 kWh/Jahr</strong></li>
             <li>2 Personen: ca. <strong>2.500 kWh/Jahr</strong></li>
             <li>3 Personen: ca. <strong>3.500 kWh/Jahr</strong></li>
             <li>4 Personen: ca. <strong>4.500 kWh/Jahr</strong></li>
             <li>5 Personen: ca. <strong>5.500 kWh/Jahr</strong></li>
             <li>6-10 Personen: typisiert mit weiter ansteigendem Haushaltsverbrauch</li>
           </ul>
           <p>Es können 1 bis 10 Personen eingegeben werden. Der Jahresverbrauch wird auf alle 8.760 Stunden des Jahres nach dem H0-Profil verteilt.</p>`
  },
  householdAnnualConsumption: {
    title: 'Haushaltsverbrauch absolut (kWh/Jahr)',
    html: `<p>Optional kann der gemessene Jahresverbrauch direkt eingetragen werden.</p>
           <p>Wenn dieser Wert gesetzt ist, wird er in der Tarifsimulation <strong>bevorzugt</strong> und die Personenzahl nur noch als Zusatzinformation genutzt.</p>`
  },
  pv: {
    title: 'Solaranlage (PV)',
    html: `<p>Gibt an, ob eine Photovoltaik-Anlage vorhanden ist. Die PV-Anlage produziert stündlich Solarstrom,
           der zuerst den Eigenbedarf deckt. Überschuss wird wahlweise im Speicher zwischengelagert oder ins Netz eingespeist.</p>
           <p>Der stündliche Ertrag ergibt sich aus:</p>
           <div class="formula">Ertrag [kWh/h] = kWp × spez. Jahresertrag × Stunden-Profil-Faktor</div>
           <p>Als Basis-Jahresertrag werden <strong>950 kWh/kWp</strong> (typisch für Sachsen/Mitteldeutschland) angesetzt, 
           skaliert mit dem monatlichen Sonnenprofil des Standorts.</p>`
  },
  peakpower: {
    title: 'PV-Leistung (kWp)',
    html: `<p>Die installierte <strong>Peakleistung</strong> der Anlage in Kilowatt-Peak (kWp) beschreibt die maximale
           Leistung unter Standardtestbedingungen (1.000 W/m², 25 °C).</p>
           <p>Typische Anlagengrößen für Einfamilienhäuser:</p>
           <ul>
             <li>Kleines Dach: <strong>4–6 kWp</strong></li>
             <li>Mittleres Dach: <strong>7–10 kWp</strong></li>
             <li>Großes Dach: <strong>11–15 kWp</strong></li>
           </ul>
           <div class="formula">Jahresertrag ≈ kWp × 900–1.050 kWh/kWp (Standortabhängig)</div>`
  },
  roofArea: {
    title: 'Dachfläche (m²)',
    html: `<p>Aus der nutzbaren Dachfläche wird die installierbare PV-Leistung errechnet:</p>
           <div class="formula">kWp = Dachfläche [m²] × Moduleffizienz [%] / 100 × 1.000 W/m² / 1.000</div>
           <p>Bei 20 m² Dachfläche und 20 % Effizienz ergibt sich z.B. <strong>4,0 kWp</strong>.</p>
           <p>Die Dachfläche bezieht sich auf die tatsächlich belegte Modulfläche, nicht die gesamte Dachfläche.</p>`
  },
  angle: {
    title: 'Dachneigung (°)',
    html: `<p>Der Neigungswinkel des Dachs beeinflusst den jährlichen PV-Ertrag über einen <strong>Korrekturfaktor</strong>:</p>
           <ul>
             <li>0° (flach): ~87 % des Optimums</li>
             <li>30–35°: ~100 % (optimal in Deutschland)</li>
             <li>60°: ~88 %</li>
             <li>90° (senkrecht): ~70 %</li>
           </ul>
           <div class="formula">Ertrag_korr = Ertrag_ideal × Neigungsfaktor(α)</div>`
  },
  aspect: {
    title: 'Ausrichtung (°)',
    html: `<p>Die Himmelsrichtung des Dachs als Abweichung von Süd in Grad:</p>
           <ul>
             <li>0° = Süd (100 % Ertrag)</li>
             <li>±45° = Südost / Südwest (~96 %)</li>
             <li>±90° = Ost / West (~78 %)</li>
             <li>±135° = Nordost / Nordwest (~62 %)</li>
             <li>±180° = Nord (~58 %)</li>
           </ul>
           <div class="formula">Ertrag_korr = Ertrag_ideal × Azimutfaktor(γ)</div>`
  },
  moduleEfficiency: {
    title: 'Moduleffizienz (%)',
    html: `<p>Gibt an, welcher Anteil der einfallenden Solarenergie in elektrische Energie umgewandelt wird.</p>
           <p>Typische Werte nach Technologie:</p>
           <ul>
             <li>Monokristallines Silizium: <strong>19–23 %</strong> (Standard)</li>
             <li>Polykristallines Silizium: <strong>15–18 %</strong></li>
             <li>Dünnschicht (CdTe, CIGS): <strong>10–14 %</strong></li>
           </ul>
           <p>Wird verwendet, um aus der Dachfläche die installierbare kWp-Leistung zu ermitteln.</p>`
  },
  pvModeKnown: {
    title: 'PV-Modus: kWp bekannt',
    html: `<p>Wählen Sie diesen Modus, wenn die installierte Anlagenleistung bereits bekannt ist.</p>
           <p>Die Berechnung nutzt den eingegebenen kWp-Wert direkt für die Ertrags- und Tarifsimulation.</p>`
  },
  pvModeCalculate: {
    title: 'PV-Modus: Dachdaten',
    html: `<p>Wählen Sie diesen Modus, wenn die kWp-Leistung noch nicht bekannt ist.</p>
           <p>Die Leistung wird aus Dachfläche, Modulwirkungsgrad, Neigung und Ausrichtung abgeleitet.</p>`
  },
  storage: {
    title: 'Stromspeicher',
    html: `<p>Ein Heimspeicher puffert überschüssigen PV-Strom, der tagsüber nicht direkt verbraucht wird,
           und stellt ihn nachts oder bei Wolken bereit.</p>
           <p>Die Simulation läuft stündlich über alle <strong>8.760 Stunden</strong> des Jahres:</p>
           <div class="formula">SOC(t) = SOC(t-1) + Laden(t) – Entladen(t)</div>
           <p>Dabei werden Ladeverluste (~5%) und die maximale Lade-/Entladeleistung berücksichtigt.
           Bei einem dynamischen Tarif optimiert der Algorithmus zusätzlich die Lade- und Entladezeiten
           nach dem stündlichen Spotpreis-Profil.</p>`
  },
  storageCapacity: {
    title: 'Speicherkapazität (kWh)',
    html: `<p>Die nutzbare Kapazität des Heimspeichers in Kilowattstunden (kWh). Typische Werte:</p>
           <ul>
             <li>Kleine Anlage: <strong>5–7,5 kWh</strong></li>
             <li>Mittlere Anlage: <strong>8–12 kWh</strong></li>
             <li>Große Anlage: <strong>13–20 kWh</strong></li>
           </ul>
           <p>Faustregel: Speicherkapazität ≈ 1–1,5 × kWp der PV-Anlage ergibt einen guten Autarkiegrad.</p>
           <div class="formula">Autarkiegrad ≈ Eigenverbrauch / Gesamtverbrauch</div>`
  },
  heatPump: {
    title: 'Wärmepumpe',
    html: `<p>Der Stromverbrauch der Wärmepumpe wird als <strong>zusätzlicher Jahresbedarf</strong>
           zum Haushaltsstromverbrauch addiert.</p>
           <p>Der Verbrauch wird nach einer typischen Heizkurve auf die Stunden des Jahres verteilt:
           mehr im Winter, weniger im Sommer.</p>
           <div class="formula">Gesamtverbrauch = Haushalt [kWh/Jahr] + Wärmepumpe [kWh/Jahr]</div>
           <p>Typische Jahreswerte je nach Gebäude:</p>
           <ul>
             <li>Neubau (gut gedämmt): <strong>2.000–3.500 kWh/Jahr</strong></li>
             <li>Saniertes Haus: <strong>3.500–6.000 kWh/Jahr</strong></li>
             <li>Altbau: <strong>6.000–12.000 kWh/Jahr</strong></li>
        </ul>
        <p>Typisch liegt der COP moderner Luft-Wasser-Wärmepumpen im Bereich 3 bis 4.</p>`
  },
  heatPumpConsumption: {
    title: 'Wärmepumpen-Verbrauch (kWh/Jahr)',
    html: `<p>Hier tragen Sie den jährlichen Stromverbrauch der Wärmepumpe ein.</p>
           <p>Dieser Wert wird als zusätzlicher Strombedarf direkt in die Tarifberechnung übernommen.</p>`
  },
  cop: {
    title: 'COP (Leistungszahl)',
    html: `<p>Der COP beschreibt, wie effizient die Wärmepumpe arbeitet:</p>
           <div class="formula">COP = abgegebene Wärmeleistung / elektrische Leistungsaufnahme</div>
           <p>Beispiel: COP 3,5 bedeutet, dass aus 1 kWh Strom etwa 3,5 kWh Wärme bereitgestellt werden.</p>
           <p>Typische Werte liegen meist zwischen 2,5 und 5, je nach System und Außentemperatur.</p>`
  },
  ev: {
      title: 'Elektrofahrzeug',
      html: `<p>Es können mehrere Elektrofahrzeuge erfasst werden. Für jedes Fahrzeug werden Batteriekapazität,
      jährliche Laufleistung, Wallbox-Leistung und optional bidirektionales Laden angegeben.</p>
        <div class="formula">Jahresverbrauch [kWh] = Fahrleistung [km/Jahr] / 100 × 20 kWh</div>
        <p>Der Gesamtverbrauch ergibt sich aus der Summe aller hinterlegten Fahrzeuge. Die Ladezeiten werden,
        sofern möglich, auf Stunden mit hohem PV-Überschuss oder niedrigem Spotpreis verschoben.</p>`
  },
  evBattery: {
    title: 'Batteriekapazität (kWh)',
      html: `<p>Die nutzbare Batteriekapazität des jeweiligen Elektroautos in kWh. Typische Werte:</p>
           <ul>
             <li>Stadtfahrzeug (z.B. VW ID.3 Basis): <strong>45–58 kWh</strong></li>
             <li>Mittelklasse (z.B. Tesla Model 3): <strong>60–82 kWh</strong></li>
             <li>SUV/Premium (z.B. BMW iX): <strong>80–110 kWh</strong></li>
        </ul>
        <p>Die Kapazität dient vor allem zur Einordnung des Fahrzeugs und der verfügbaren BiDi-Speichergröße.</p>`
  },
  evWallbox: {
    title: 'Wallbox-Leistung (kW)',
    html: `<p>Gibt die maximale Ladeleistung der jeweiligen Wallbox an. Dieser Wert beeinflusst Ladeverluste
           und damit den jährlichen Strombedarf des Fahrzeugs in der Simulation.</p>
           <ul>
             <li>einphasig: <strong>3,7-4,6 kW</strong></li>
             <li>dreiphasig Standard: <strong>11 kW</strong></li>
             <li>High-Power AC: <strong>22 kW</strong></li>
           </ul>`
  },
  evAnnualKm: {
    title: 'Jährliche Laufleistung (km)',
    html: `<p>Die jährliche Fahrleistung ist der Haupttreiber für den Energiebedarf des Fahrzeugs.</p>
           <div class="formula">Traktionsbedarf [kWh/Jahr] = km/Jahr / 100 × Verbrauch [kWh/100 km]</div>`
  },
  largeLoad: {
    title: 'Großverbraucher > 4,2 kW',
    html: `<p>Hier erfassen Sie steuerbare Großverbraucher mit Leistung, Betriebszeiten und Nutzungshäufigkeit.</p>
           <p>Das Tagesprofil zeigt stündlich die Stromkosten basierend auf realistischen Spotpreis-Profilen.</p>
           <p><strong>Tipp:</strong> Verschieben Sie die Betriebszeiten in günstige Nachtstunden für niedrigere Kosten!</p>`
  },
  largeLoadPower: {
    title: 'Leistung (kW)',
    html: `<p>Nennleistung des Großverbrauchers in Kilowatt. Muss mindestens 4,2 kW betragen.</p>
           <p>Beispiele: Sauna 6-10 kW, Wäschetrockner 5-8 kW, Durchlauferhitzer 18-27 kW.</p>`
  },
  largeLoadStart: {
    title: 'Startstunde',
    html: `<p>Uhrzeit, wann das Gerät normalerweise zu laufen beginnt (0-23 Uhr).</p>
           <p>Beispiel: Nachtspeicherheizung startet um 22:00 Uhr (22).</p>
           <p>Falls das Gerät über Mitternacht läuft, gibt die Startstunde einen frühen Wert an (z.B. 22) und die Endstunde einen späteren (z.B. 6).</p>`
  },
  largeLoadEnd: {
    title: 'Endstunde',
    html: `<p>Uhrzeit, wann das Gerät normalerweise aufhört zu laufen (0-23 Uhr).</p>
           <p>Beispiel: Nachtspeicherheizung endet um 6:00 Uhr (6).</p>
           <p><strong>Wichtig für Kostenoptimierung:</strong> Die günstigsten Stunden sind meist nachts 22:00-06:00 Uhr (~18-22 ct/kWh).</p>`
  },
  largeLoadUsageDays: {
    title: 'Nutzungstage pro Woche',
    html: `<p>An wieviel Tagen pro Woche wird das Gerät durchschnittlich betrieben? (1-7 Tage).</p>
           <p>Beispiele: Sauna 2x/Woche, Wäschetrockner 3x/Woche, Speicherheizung täglich (7).</p>`
  },
  evChargingStart: {
    title: 'Ladestundenplan - Start',
    html: `<p>Uhrzeit, wann das Auto normalerweise zu laden beginnt (0-23 Uhr).</p>
           <p>Beispiel: Nächtliches Laden beginnend um 22:00 Uhr (22).</p>
           <p><strong>Optimierungstipp:</strong> Verschieben Sie das Laden in günstige Nachtstunden 22:00-06:00 Uhr (~18-22 ct/kWh) für minimale Kosten!</p>`
  },
  evChargingEnd: {
    title: 'Ladestundenplan - End',
    html: `<p>Uhrzeit, wann das Auto normalerweise zu laden ends (0-23 Uhr).</p>
           <p>Beispiel: Laden endet um 6:00 Uhr (6).</p>
           <p>Falls das Laden über Mitternacht läuft (z.B. 22-06), werden die teuren Morgen-/Tagstunden (35-50 ct/kWh) vermieden.</p>`
  },
  bidi: {
    title: 'Bidirektionales Laden (V2H)',
    html: `<p>Beim bidirektionalen Laden (<strong>Vehicle-to-Home</strong>) kann das E-Auto auch als
           mobiler Speicher genutzt werden: Strom wird bei günstigen Konditionen geladen und
           bei Bedarf (z.B. Abends oder bei hohem Spotpreis) zurück ins Haus gespeist.</p>
           <p>Die Simulation begrenzt die maximale rückgespeiste Energiemenge auf
           <strong>~12 % des Jahresbedarfs</strong>, um eine realistische Nutzung abzubilden.</p>
           <p>Voraussetzung: Fahrzeug und Ladestation müssen V2H-zertifiziert sein (z.B. Nissan Leaf, Hyundai Ioniq 5/6).</p>`
  },
  dynamicTariff: {
    title: 'Dynamischer Stromtarif',
    html: `<p>Beim dynamischen Tarif (<em>Strom Flex</em>) richtet sich der Arbeitspreis stündlich nach dem
           <strong>EPEX-Spot-Marktpreis</strong> (Day-Ahead, €/MWh).</p>
           <div class="formula">Strompreis [ct/kWh] = EPEX-Spot + 2,98 ct Basisverbrauchspreis + Umlagen/Abgaben</div>
           <p>Die Simulation verwendet historische Spotpreisdaten 2025 (8.760 Stunden).
           Bei Aktivierung wird für jede Stunde der günstigste Beschaffungszeitpunkt ermittelt –
           besonders wirksam in Kombination mit Speicher und E-Auto.</p>
           <p>Grundpreis (SachsenEnergie): 83,82 EUR/Jahr + 35,70 EUR/Jahr Netznutzungs-Grundpreis,
           Messsystemkosten je nach Zählertyp (im Modell bei iMSys typischerweise 30 EUR/Jahr,
           bei §14a pauschal 50 EUR/Jahr).</p>`
  },

  // ── Ergebnis-Bereich ────────────────────────────────────────────────────
  resRecommendation: {
    title: 'Empfehlung',
      html: `<p>Das Modell bewertet alle simulierten Tarif- und §14a-Kombinationen und gibt den <strong>kostenoptimalen Tarif</strong>
        samt <strong>empfohlenem Modul</strong> für Ihr individuelles Profil aus.</p>
           <p>Die Empfehlung basiert auf dem niedrigsten Netto-Jahresbetrag (Energiekosten + Grundpreis + Netzentgelt
           − Einspeisevergütung) über alle 8.760 Stunden der Simulation.</p>
           <p>Sie berücksichtigt automatisch Ihre aktivierten Komponenten (PV, Speicher, WP, E-Auto) und
        prüft die zulässigen §14a-Module ohne manuelle Vorauswahl.</p>`
  },
  resConsumption: {
    title: 'Jahresverbrauch',
    html: `<p>Gesamter elektrischer Jahresverbrauch des Haushalts in kWh, berechnet als Summe aller Komponenten:</p>
           <div class="formula">Gesamt = Haushalt + Wärmepumpe + Elektrofahrzeug</div>
           <ul>
             <li><strong>Haushalt:</strong> Personenzahl × BDEW-H0-Profil</li>
             <li><strong>Wärmepumpe:</strong> direkt eingegebener Jahreswert (auf Heizkurve verteilt)</li>
             <li><strong>E-Auto:</strong> Batteriekapazität × 50 Ladezyklen/Jahr</li>
           </ul>
           <p>Eigenerzeugung durch die PV-Anlage senkt den <em>Netzbezug</em>, nicht den Gesamtverbrauch.</p>`
  },
  resYield: {
    title: 'PV-Jahresertrag',
    html: `<p>Die simulierte Jahres-Stromerzeugung der PV-Anlage in kWh, berechnet als stündliche Summe aller 8.760 Stunden:</p>
           <div class="formula">Ertrag [kWh/Jahr] = kWp × spez. Jahresertrag × Neigungsfaktor × Azimutfaktor</div>
           <p>Der spezifische Jahresertrag (~950 kWh/kWp) wird mit dem monatlichen Sonnenprofil des PLZ-Standorts
           gewichtet. Verluste durch Verschattung oder Wechselrichter sind pauschal mit ~5 % eingerechnet.</p>`
  },
  resSaving: {
    title: 'Ersparnis gegenüber Strom Pur',
    html: `<p>Differenz zwischen den Jahreskosten des <strong>Strom Pur</strong>-Basistarifs und dem
           empfohlenen Tarif-Szenario:</p>
           <div class="formula">Ersparnis = Kosten(Strom Pur) − Kosten(empfohlener Tarif)</div>
           <p>Ein positiver Wert bedeutet: Sie sparen mit dem empfohlenen Tarif gegenüber dem Standardangebot.
           Die Ersparnis steigt typisch mit höherem PV-Eigenverbrauch und flexiblem Verbrauchsprofil.</p>`
  },
  resCoords: {
    title: 'Standort-Koordinaten',
    html: `<p>Aus der eingegebenen PLZ ermittelter geografischer Mittelpunkt des Postleitzahlgebiets
           (Breitengrad / Längengrad).</p>
           <p>Diese Koordinaten bestimmen das monatliche Sonneneinstrahlung-Profil für die PV-Berechnung.
           Süddeutsche Standorte erzielen bis zu <strong>20 % mehr Ertrag</strong> als norddeutsche.</p>`
  },
  resBuilding: {
    title: 'Gebäudetyp',
    html: `<p>Aktuell wird ausschließlich der Typ <strong>EFH</strong> (Einfamilienhaus) simuliert,
           der dem BDEW-Lastprofil H0 entspricht.</p>
           <p>Dieses Profil beschreibt einen typischen Haushalt mit gleichmäßig verteilten Tages-,
           Wochen- und Saisonlasten. Gewerbliche oder landwirtschaftliche Profile sind nicht enthalten.</p>`
  },
  resBidi: {
    title: 'Bidirektionales Laden (V2H)',
    html: `<p>Zeigt, ob die V2H-Funktion (Vehicle-to-Home) in der Berechnung aktiv war.</p>
           <p>Wenn aktiv, kann das E-Auto-Akku bis zu <strong>~12 % des Jahresbedarfs</strong>
           ins Hausnetz zurückspeisen – bevorzugt zu Zeiten hoher Spotpreise oder
           fehlender PV-Einspeisung. Der Wert gibt die tatsächlich rückgespeiste Energie an.</p>`
  },
  resUncertainty: {
    title: 'Modell-Unsicherheit',
    html: `<p>Gibt eine qualitative Einschätzung der Ergebnissicherheit an:</p>
           <ul>
             <li><strong>Niedrig:</strong> Alle Eingabewerte sind vollständig und plausibel,
             Lastprofile passen zum Szenario.</li>
             <li><strong>Mittel:</strong> Einzelne Parameter wurden geschätzt oder liegen an
             Rändern des typischen Bereichs.</li>
             <li><strong>Hoch:</strong> Wesentliche Unsicherheiten in den Eingangsdaten,
             z.B. unbekannte Dachausrichtung oder sehr ungewöhnliche Verbräuche.</li>
           </ul>`
  },
  tariffTable: {
    title: 'Tarifvergleich',
    html: `<p>Zeigt die berechneten Jahreskosten für jeden simulierten Tarif nebeneinander:</p>
           <ul>
             <li><strong>Netto EUR/Jahr:</strong> Energiekosten + Netzentgelt + Grundpreis − Einspeisevergütung</li>
             <li><strong>Energie:</strong> Beschaffungs-/Markup-Anteil des Arbeitspreises</li>
             <li><strong>Netz und Grundpreis:</strong> Netznutzungsentgelt + Umlagen + Grundgebühr + Messkosten</li>
             <li><strong>Einspeisung:</strong> Erlöse aus PV-Überschusseinspeisung (EEG 2023, 7,78 ct/kWh für ≤10 kWp)</li>
           </ul>
           <p>Alle Werte gelten für ein vollständiges Simulationsjahr (8.760 Stunden).</p>`
  },
  monthlyChart: {
    title: 'Monatsbilanz',
    html: `<p>Zeigt für den empfohlenen Tarif die monatliche Energiebilanz über das Simulationsjahr:</p>
           <ul>
             <li><strong>Netzbezug:</strong> aus dem öffentlichen Netz bezogene Energie je Monat</li>
             <li><strong>Einspeisung:</strong> ins Netz zurückgespeiste PV-Überschussenergie</li>
             <li><strong>Eigenverbrauch:</strong> direkt selbst genutzte PV-Energie</li>
           </ul>
           <p>Im Sommer überwiegt meist Eigenverbrauch und Einspeisung, im Winter der Netzbezug.</p>`
  },
  balanceChart: {
    title: 'Monatliche Energiebilanz',
    html: `<p>Balkendiagramm der monatlichen <strong>Energiebilanz</strong> in kWh:</p>
           <div class="formula">Bilanz [kWh] = PV-Ertrag − Gesamtverbrauch</div>
           <ul>
             <li><strong style="color:#0B8F6A">Oberhalb X-Achse</strong> — PV produziert mehr als verbraucht wird: Überschuss wird eingespeist oder im Speicher gepuffert.</li>
             <li><strong style="color:#E3223A">Unterhalb X-Achse</strong> — Verbrauch übersteigt PV-Ertrag: Differenz wird aus dem Netz bezogen.</li>
           </ul>
           <p>Die hervorgehobene X-Achsen-Linie markiert den Nullpunkt (Ausgeglichenheit).
           Im Sommer dominieren typisch positive, im Winter negative Werte.</p>`
  },
  transparency: {
    title: 'Daten-Transparenz',
    html: `<p>Listet alle in der Berechnung verwendeten Quelldaten und Annahmen auf:</p>
           <ul>
             <li><strong>Lastprofil:</strong> BDEW-H0 (normiert, skaliert auf Jahresverbrauch)</li>
             <li><strong>PV-Ertrag:</strong> Standortprofil aus PLZ, spez. Ertrag ≈950 kWh/kWp (konservativ für Sachsen; PVGIS-Referenz ca. 1.000–1.050 kWh/kWp)</li>
             <li><strong>Spotpreise:</strong> EPEX Day-Ahead, Live-Stundenwerte via aWATTar API; Fallback: historisches Profil 2025</li>
             <li><strong>Netzentgelte:</strong> SachsenEnergie / SachsenNetze 2026 (brutto inkl. 19 % MwSt.)</li>
             <li><strong>Einspeisevergütung:</strong> EEG 2023, Stand Feb–Jul 2026: 7,78 ct/kWh (≤10 kWp Teileinspeisung), 6,73 ct/kWh (10–40 kWp)</li>
             <li><strong>Tarifdaten:</strong> Strom Pur / Strom Flex, SachsenEnergie Stand März 2026</li>
           </ul>
           <p>Alle Werte dienen zur Orientierung und ersetzen keine individuelle Energieberatung.</p>`
  },

  // ── Live-Marktpreis Ticker ───────────────────────────────────────────────
  liveTicker: {
    title: 'Live-Marktpreis Ticker',
    html: `<p>Der Ticker zeigt aktuelle EPEX-Day-Ahead-Spotpreise in Echtzeit und aktualisiert sich automatisch
           zum Beginn jeder vollen Stunde – dem Zeitpunkt, an dem ein neues Markt-Preisfenster beginnt.</p>
           <p>Datenquelle: <strong>aWATTar API</strong> (EPEX Day-Ahead, stündliche Werte).</p>
           <p>Der angezeigte Spotpreis ist der Börsenpreis ohne Netzentgelte und Steuern.
           Der dynamische Tarifpreis enthält zusätzlich Aufschlag und Umlagen gemäß Ihrem Tarif.</p>`
  },
  tickerSpotPrice: {
    title: 'Spotpreis aktuell (absolut)',
    html: `<p>Der aktuelle <strong>EPEX-Day-Ahead-Spotpreis</strong> für die laufende Stunde in ct/kWh.</p>
           <p>Dies ist der reine Börseneinkaufspreis, ohne Netzentgelte, Steuern oder Aufschläge.</p>
           <div class="formula">Spotpreis [ct/kWh] = EPEX-Marktpreis [EUR/MWh] ÷ 10</div>
           <p>Negative Spotpreise sind möglich bei Überangebot (z.B. viel Wind + wenig Verbrauch).</p>`
  },
  tickerDynamicPrice: {
    title: 'Dynamischer Tarifpreis aktuell (absolut)',
    html: `<p>Der vollständige Arbeitspreis des dynamischen Tarifs für die aktuelle Stunde:</p>
           <div class="formula">Dynamischer Preis = Spotpreis + Aufschlag + Umlagen/Abgaben</div>
           <ul>
             <li><strong>Spotpreis:</strong> aktueller EPEX-Day-Ahead-Marktwert</li>
             <li><strong>Aufschlag:</strong> Basisverbrauchspreis (2,98 ct/kWh)</li>
             <li><strong>Umlagen:</strong> Steuern, Abgaben und Netzentgeltanteile</li>
           </ul>
           <p>Dieser Wert entspricht dem, was Sie beim dynamischen Tarif <em>Strom Flex</em> pro kWh Netzbezug zahlen.</p>`
  },
  tickerChange: {
    title: 'Änderung zum letzten Wert',
    html: `<p>Zeigt die Preisrichtung gegenüber dem zuletzt gespeicherten Stundenwert:</p>
           <ul>
             <li><strong class="trend-up">steigend</strong> — Preis ist gegenüber der Vorperiode gestiegen</li>
             <li><strong class="trend-down">fallend</strong> — Preis ist gegenüber der Vorperiode gefallen</li>
             <li><strong class="trend-flat">seitwärts</strong> — Preis ist nahezu unverändert (&lt; 0,001 ct/kWh Differenz)</li>
           </ul>
           <p>Die Änderung basiert auf den letzten zwei gespeicherten Stundenwerten in der Verlaufshistorie.</p>`
  },
  tickerWindow: {
    title: 'Gültiges Preisfenster',
    html: `<p>Der Zeitraum, für den der aktuell angezeigte Spotpreis gilt.</p>
           <p>EPEX-Day-Ahead-Preise gelten immer für eine volle Stunde (z.B. 14:00–15:00 Uhr).
           Das Fenster wechselt automatisch zur vollen Stunde und der Ticker aktualisiert sich entsprechend.</p>
           <p>Der Ticker synchronisiert sich beim Laden der Seite mit dem aktuellen Marktfenster
           und plant das nächste Update genau zum Beginn der Folgestunde.</p>`
  }
};

Object.assign(INFO_TEXTS, {
  heatingSourcesInfo: {
    title: 'Heizquellen',
    html: `<p>Hier können Sie alle Heizquellen des Haushalts erfassen – auch mehrere gleichzeitig (z.&nbsp;B. Gas + Fernwärme).</p>
           <p><strong>Wichtig:</strong> Gas, Öl, Holz und Fernwärme fließen <em>nicht</em> in den elektrischen Stromverbrauch ein –
           sie werden separat ausgewiesen. Nur die Wärmepumpe wird als Stromabnehmer in der Tarifberechnung berücksichtigt.</p>
           <p>Quelle: Energieausweis-Systematik gemäß EnEV / GEG (Gebäudeenergiegesetz 2023).</p>`
  },
  inputsOverview: {
    title: 'Heizung',
    html: '<p>Hier wird die Heizart und der Heizverbrauch für die Energieanalyse erfasst.</p>'
  },
  areaM2: {
    title: 'Wohnfläche (m²)',
    html: `<p>Die Wohnfläche ist die Bezugsbasis für Kosten und Verbräuche pro Quadratmeter.</p>
           <p>Typische Wohnflächen: Einfamilienhaus 100–180 m², Wohnung 50–120 m².</p>
           <p>Quelle: Statistisches Bundesamt – Durchschnittliche Wohnfläche je Wohnung in Deutschland (2023): ca. 92 m².</p>`
  },
  powerTariff: {
    title: 'Aktueller Stromtarif',
    html: '<p>Der Tariftyp dient der Einordnung. Der tatsächliche Durchschnittspreis wird aus Kosten und Verbrauch berechnet.</p>'
  },
  annualPowerCost: {
    title: 'Jährliche Stromkosten (EUR)',
    html: `<p>Gesamte Stromkosten pro Jahr in Euro (aus der letzten Jahresabrechnung).</p>
           <p>Quelle: BDEW Strompreisanalyse 2025 – Ø Haushaltsstrompreis Deutschland ca. 31–33 ct/kWh (brutto inkl. MwSt.).</p>`
  },
  annualPowerUse: {
    title: 'Jährlicher Stromverbrauch (kWh)',
    html: '<p>Gesamter Haushaltsstromverbrauch pro Jahr in kWh.</p>'
  },
  heatingType: {
    title: 'Heizart',
    html: `<p>Abhängig von der Heizart werden unterschiedliche Kostenmodelle und Wirkungsgrade genutzt:</p>
           <ul>
             <li><strong>Fernwärme:</strong> ~14,5 ct/kWh + Grundpreis</li>
             <li><strong>Gas:</strong> ~12 ct/kWh (1 m³ Erdgas ≈ 10 kWh Heizwert, Hi)</li>
             <li><strong>Öl:</strong> ~11 ct/kWh (1 Liter Heizöl ≈ 10 kWh Heizwert, Hi)</li>
             <li><strong>Holz/Pellets:</strong> ~8 ct/kWh (1 kg Pellets ≈ 5 kWh)</li>
             <li><strong>Wärmepumpe:</strong> Strombezug × COP → thermische Energie</li>
           </ul>
           <p>Quelle: BDEW/VEA Energiemarktreport 2025; DEPV (Deutsche Energie-Pellet-Verband) 2025.</p>`
  },
  heatingConsumption: {
    title: 'Jährlicher Heizverbrauch',
    html: `<p>Jährlicher Verbrauch der gewählten Heizart in kWh-Äquivalent.</p>
           <p>Bei der Wärmepumpe ist das der elektrische Heizstromverbrauch (aus dem Großverbraucher-Schritt).</p>
           <p>Umrechnungshilfe: Gas 1 m³ ≈ 10 kWh | Heizöl 1 Liter ≈ 10 kWh | Pellets 1 kg ≈ 5 kWh.</p>`
  },
  districtBasePrice: {
    title: 'Fernwärme Grundpreis (EUR/Jahr)',
    html: `<p>Fixer Jahrespreis, der bei Fernwärme zusätzlich zum Arbeitspreis angesetzt wird.</p>
           <p>Typischer Grundpreis in Deutschland: 300–600 EUR/Jahr je nach Anbieter und Anschlussleistung.</p>
           <p>Quelle: AGFW (Arbeitsgemeinschaft Fernwärme) Branchenreport 2024.</p>`
  },
  resultsOverview: {
    title: 'Energieanalyse: Ergebnisse',
    html: '<p>Zeigt Kennzahlen zu Strom, Heizung, Effizienzklasse und Kostenvergleich alternativer Heizsysteme.</p>'
  },
  resPowerUse: {
    title: 'Gesamtstromverbrauch/Jahr',
    html: `<p>Der simulierte elektrische Jahresstromverbrauch in kWh, berechnet aus Haushalt + Wärmepumpe + E-Auto.</p>
           <p>Dieser Wert fließt direkt in die Tarifberechnung ein.</p>`
  },
  resPowerPrice: {
    title: 'Ø Strompreis (ct/kWh)',
    html: `<p>Durchschnittlicher Strompreis: Jährliche Stromkosten geteilt durch den Jahresverbrauch.</p>
           <p>Quelle: BDEW Strompreisanalyse – Ø Haushaltsstrompreis 2025 ca. 31–33 ct/kWh.</p>`
  },
  resPowerPerM2: {
    title: 'Stromkosten pro m²',
    html: '<p>Stromkosten bezogen auf die Wohnfläche – zur Vergleichbarkeit mit Energieausweiswerten.</p>'
  },
  resHeatCost: {
    title: 'Heizkosten/Jahr',
    html: `<p>Jährliche Heizkosten (Summe aller Heizquellen) basierend auf den eingegebenen Verbräuchen und typischen Energiepreisen.</p>
           <p>Quelle: co2online Heizspiegel Deutschland 2024.</p>`
  },
  resHeatPerM2: {
    title: 'Heizverbrauch pro m²',
    html: `<p>Normierter Wärmebedarf in kWh/(m²·Jahr) – Grundlage für die Effizienzbewertung (Energieausweis-Systematik).</p>
           <p>Quelle: GEG 2023 / DIN V 18599 – Referenzwerte für Wohngebäude.</p>`
  },
  resEfficiency: {
    title: 'Effizienzbewertung (Energieklasse)',
    html: `<p>Klasse A bis E basierend auf dem Wärmebedarf pro Quadratmeter:</p>
           <ul>
             <li><strong>A</strong> ≤ 40 kWh/(m²·a) – Sehr gut (Neubau/Passivhaus)</li>
             <li><strong>B</strong> ≤ 70 kWh/(m²·a) – Gut (KfW-55)</li>
             <li><strong>C</strong> ≤ 110 kWh/(m²·a) – Mittel (sanierter Altbau)</li>
             <li><strong>D</strong> ≤ 160 kWh/(m²·a) – Schlecht</li>
             <li><strong>E</strong> &gt; 160 kWh/(m²·a) – Sehr schlecht (unsanierter Altbau)</li>
           </ul>
           <p>Quelle: Energieausweis-Anforderungen nach GEG 2023 / EnEV.</p>`
  },
  resHeatCostPerKwh: {
    title: 'Heizkosten pro kWh',
    html: `<p>Jährliche Heizkosten geteilt durch den Heizenergieverbrauch in kWh.</p>
           <p>Vergleichswerte 2025: Gas ca. 12 ct/kWh | Fernwärme ca. 14–16 ct/kWh | Heizöl ca. 10–12 ct/kWh.</p>`
  },
  resHeatCostPerM2: {
    title: 'Heizkosten pro m²',
    html: `<p>Jährliche Heizkosten bezogen auf die Wohnfläche (EUR/(m²·a)).</p>
           <p>Typische Richtwerte: Gut gedämmt ≤ 8 €/m² | Mittleres Gebäude 8–15 €/m² | Altbau &gt; 15 €/m².</p>`
  },
  heatingCompareTable: {
    title: 'Vergleich alternativer Heizsysteme',
    html: `<p>Vergleicht geschätzten Energieverbrauch und Jahreskosten aller Heizsystemalternativen mit Ihrem aktuellen System.</p>
           <p>Basis: gleicher Wärmebedarf (kWh/a), unterschiedliche Wirkungsgrade und Energiepreise 2025.</p>
           <p>Quelle: co2online Heizkostenrechner 2025; BDEW Energiemarktreport 2025.</p>`
  }
});

// ─── Modal-Logik ─────────────────────────────────────────────────────────────
const infoModal      = byId('infoModal');
const infoModalTitle = byId('infoModalTitle');
const infoModalBody  = byId('infoModalBody');
const infoModalClose = byId('infoModalClose');
const evVehiclesContainer = byId('evVehicles');
const evProfileSection = byId('evProfileSection');
const evProfilesContainer = byId('evProfiles');
const addEvBtn = byId('addEvBtn');
const largeLoadsContainer = byId('largeLoads');
const largeLoadProfileSection = byId('largeLoadProfileSection');
const largeLoadProfilesContainer = byId('largeLoadProfiles');
const addLargeLoadBtn = byId('addLargeLoadBtn');

function reportInitError(message) {
  console.error(message);
  if (!apiStatus) {
    return;
  }

  apiStatus.textContent = 'Frontend-Fehler beim Starten';
  apiStatus.classList.remove('ok');
  apiStatus.classList.add('fail');
  apiStatus.title = message;
}

function runInitStep(name, fn) {
  try {
    fn();
  } catch (error) {
    const detail = error?.message || String(error);
    reportInitError(`Initialisierung fehlgeschlagen (${name}): ${detail}`);
  }
}

function openInfoModal(key) {
  const entry = INFO_TEXTS[key];
  if (!entry || !infoModalTitle || !infoModalBody || !infoModal || !infoModalClose) return;
  infoModalTitle.textContent = entry.title;
  infoModalBody.innerHTML    = entry.html;
  infoModal.classList.remove('hidden');
  infoModalClose.focus();
}

function closeInfoModal() {
  if (!infoModal) {
    return;
  }
  infoModal.classList.add('hidden');
}

// Open via any info-btn
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.info-btn');
  if (btn) {
    e.stopPropagation();
    openInfoModal(btn.dataset.info);
  }
});

// Close via × button
infoModalClose?.addEventListener('click', closeInfoModal);

// Close on overlay click (click outside modal-box)
infoModal?.addEventListener('click', (e) => {
  if (e.target === infoModal) closeInfoModal();
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && infoModal && !infoModal.classList.contains('hidden')) closeInfoModal();
});

init();

function init() {
  if (!form || !calcBtn) {
    return;
  }

  runInitStep('Formular freischalten', unlockAllFormInputs);
  runInitStep('Formular-Wizard', initWizard);
  runInitStep('Entscheidungsbuttons', initDecisionButtons);
  runInitStep('14a-Modulfluss', initModuleDecisionFlow);
  runInitStep('Energieanalyse', initEnergyAnalysisSection);
  runInitStep('Haushaltsverbrauch', initHouseholdConsumptionMode);
  runInitStep('E-Autos', initEvVehicles);
  runInitStep('Grossverbraucher', initLargeLoads);

  runInitStep('Komponenten-Toggles', () => {
    const componentToggles = document.querySelectorAll('.component-toggle');
    const controlledSections = document.querySelectorAll('.pvFields, .storageFields, .heatPumpFields, .evFields, .largeLoadFields');

    // Safety reset: remove stale disabled states that could survive from cached DOM/CSS states.
    controlledSections.forEach((section) => {
      setSectionEnabled(section, true);
    });

    const syncComponentToggleState = (toggleEl) => {
      const targetId = toggleEl.dataset.target;
      const targetDiv = byId(targetId);
      if (!targetDiv) {
        return;
      }

      const isEnabled = toggleEl.checked;
      setSectionEnabled(targetDiv, isEnabled);
      setFieldsetActiveState(toggleEl, isEnabled);
      syncDecisionButtons(toggleEl.id, isEnabled);

      if (targetId === 'evFields' && addEvBtn) {
        addEvBtn.disabled = !isEnabled;
      }
      if (targetId === 'largeLoadFields' && addLargeLoadBtn) {
        addLargeLoadBtn.disabled = !isEnabled;
      }

      if (isEnabled && targetId === 'evFields') {
        ensureAtLeastOneEvVehicle();
      }
      if (isEnabled && targetId === 'largeLoadFields') {
        ensureAtLeastOneLargeLoad();
        updateLargeLoadProfiles();
      }
      if (!isEnabled && targetId === 'largeLoadFields' && largeLoadsContainer) {
        largeLoadsContainer.innerHTML = '';
        largeLoadProfileSection?.classList.add('hidden');
      }
    };

    componentToggles.forEach((toggle) => {
      toggle.addEventListener('change', () => syncComponentToggleState(toggle));
      syncComponentToggleState(toggle);
    });

    // Safety pass for browsers/cache races: enforce state once again after first paint.
    setTimeout(() => {
      componentToggles.forEach((toggle) => syncComponentToggleState(toggle));
      unlockAllFormInputs();
    }, 0);
  });

  runInitStep('PV-Modus', () => {
    const pvModeRadios = document.querySelectorAll('input[name="pvMode"]');
    pvModeRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const pvKnownSection = byId('pvKnownSection');
        const pvCalcSection = byId('pvCalcSection');
        if (!pvKnownSection || !pvCalcSection) {
          return;
        }

        if (e.target.value === 'known') {
          pvKnownSection.classList.remove('hidden');
          pvCalcSection.classList.add('hidden');
        } else {
          pvKnownSection.classList.add('hidden');
          pvCalcSection.classList.remove('hidden');
        }
      });
    });
  });

  runInitStep('Backend-Status', () => {
    void checkApiReachability();
  });

  runInitStep('Berechnungsformular', () => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!isWizardOnLastStep()) {
        goToWizardStep(wizardState.currentIndex + 1, 'forward');
        return;
      }

      clearError();
      clearSuccess();

      try {
        const payload = buildPayload();
        const validationError = validatePayload(payload);
        if (validationError) {
          showError(validationError);
          return;
        }

        setLoading(true);

        const { response } = await apiFetch('/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Serverfehler bei der Berechnung.');
        }

        latestData = result.data;
        renderResults(result.data);
        renderEnergyAnalysis();
        exportBtn.disabled = false;
        resultsSection.classList.remove('hidden');
        energyResultsSection?.classList.remove('hidden');
        showSuccess(buildSuccessMessage(result.data));
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        showError(error.message || 'Backend nicht erreichbar.');
      } finally {
        setLoading(false);
      }
  });
  });

  runInitStep('Export', () => {
    exportBtn?.addEventListener('click', () => {
      if (!latestData) return;
      const name = `kalkulation_${new Date().toISOString().slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(latestData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    });
  });

  runInitStep('Marktticker', () => {
    if (marketTickerRefresh) {
      marketTickerRefresh.addEventListener('click', async () => {
        await updateMarketTicker(true);
        scheduleMarketTicker();
      });
    }

    window.addEventListener('beforeunload', stopMarketTicker);
  });
}

async function checkApiReachability() {
  if (!apiStatus) return;

  apiStatus.textContent = 'Backend-Status wird geprüft...';
  apiStatus.classList.remove('ok', 'fail');

  try {
    const { response, base } = await apiFetch('/market-live', {
      method: 'GET',
      timeoutMs: 5000
    });

    if (response.ok) {
      apiStatus.textContent = `Backend erreichbar (${base})`;
      apiStatus.classList.add('ok');
    } else {
      throw new Error('API antwortet mit Fehlerstatus.');
    }
  } catch (_) {
    apiStatus.textContent = 'Backend aktuell nicht erreichbar';
    apiStatus.classList.add('fail');
  }
}

function buildPayload() {
  const pvMode = document.querySelector('input[name="pvMode"]:checked').value;
  const hasPv = byId('hasPv').checked;
  const hasStorage = byId('hasStorage').checked;
  const hasHeatPump = byId('hasHeatPump').checked;
  const hasEv = byId('hasEv').checked;
  const hasOtherLargeLoad = byId('hasOtherLargeLoad')?.checked === true;
  const hasLargeLoad42 = byId('hasLargeLoad42')?.checked === true;
  const evVehicles = hasEv ? collectEvVehicles() : [];
  const largeLoads = hasLargeLoad42 && hasOtherLargeLoad ? collectLargeLoads() : [];
  const largeLoadDailyCurveKw = buildLargeLoadDailyCurveKw(largeLoads);
  const largeLoadCount = largeLoads.length;
  const largeLoadPowerKw = largeLoads.reduce((max, load) => Math.max(max, load.powerKw || 0), 0);

  let pvData = {
    hasPv,
    peakpower_kwp: null,
    angle_deg: null,
    aspect_deg: null,
    loss_pct: null
  };

  if (pvMode === 'known' && hasPv) {
    // User knows their exact kWp
    pvData.peakpower_kwp = optionalNumber('peakpower');
  } else if (pvMode === 'calculate' && hasPv) {
    // User provides roof data for calculation
    // Calculate kWp from roof area and module efficiency
    const roofArea = optionalNumber('roofArea');
    const moduleEfficiency = optionalNumber('moduleEfficiency');
    
    if (roofArea && moduleEfficiency) {
      // kWp = area (m²) × efficiency (%) / 100
      pvData.peakpower_kwp = roofArea * (moduleEfficiency / 100);
    }
    
    pvData.angle_deg = optionalNumber('angle');
    pvData.aspect_deg = optionalNumber('aspect');
  }

  const consumptionKnown = byId('consumptionKnown')?.checked === true;
  const personsRaw = parseInt(byId('persons').value, 10);
  const persons = Number.isInteger(personsRaw) ? personsRaw : 2;

  let annualHouseholdConsumption;
  if (consumptionKnown) {
    annualHouseholdConsumption = optionalNumber('householdAnnualConsumption');
  } else {
    const AVG_KWH = [0, 1500, 2500, 3500, 4500, 5500, 6500, 7500, 8500, 9500, 10500];
    annualHouseholdConsumption = AVG_KWH[persons] ?? persons * 1000 + 500;
  }

  const moduleDecision = determineModuleDecision();

  return {
    household: {
      plz: byId('plz').value.trim(),
      persons,
      buildingType: 'EFH',
      annualConsumption_kwh: annualHouseholdConsumption
    },
    pv: pvData,
    storage: {
      hasStorage,
      capacity_kwh: hasStorage ? optionalNumber('storageCapacity') : null,
      maxPower_kw: 3,
      efficiency: 0.92,
      useDynamicOptimization: true
    },
    heatPump: {
      hasHeatPump,
      annualConsumption_kwh: hasHeatPump ? optionalNumber('heatPumpConsumption') : null,
      cop: hasHeatPump ? optionalNumber('heatPumpCop') : null
    },
    emobility: {
      hasEV: hasEv && evVehicles.length > 0,
      annualKm: evVehicles.reduce((sum, vehicle) => sum + (vehicle.annualKm || 0), 0),
      consumption_kwh_per_100km: 20,
      chargingPower_kw: evVehicles.length ? Math.max(...evVehicles.map((vehicle) => vehicle.wallboxPower_kw || 0)) : 11,
      preferNightCharging: true,
      useBidirectional: evVehicles.some((vehicle) => vehicle.useBidirectional),
      vehicles: evVehicles
    },
    tariff: {
      compareStaticTariff: true,
      compareDynamicTariff: true,
      module14a: moduleDecision.module,
      largeLoadOver42kw: hasLargeLoad42,
      largeLoadCount,
      largeLoadPowerKw,
      largeLoads,
      largeLoadDailyCurveKw
    }
  };
}

function validatePayload(payload) {
  const plzEl = byId('plz');
  const personsEl = byId('persons');
  const annualConsumptionEl = byId('householdAnnualConsumption');
  const consumptionKnown = byId('consumptionKnown')?.checked === true;
  plzEl.classList.remove('invalid');
  personsEl?.classList.remove('invalid');
  annualConsumptionEl?.classList.remove('invalid');

  if (!/^\d{5}$/.test(payload.household.plz)) {
    plzEl.classList.add('invalid');
    return 'Bitte eine gültige 5-stellige PLZ eingeben.';
  }

  if (!consumptionKnown) {
    if (!Number.isInteger(payload.household.persons) || payload.household.persons < 1 || payload.household.persons > 10) {
      personsEl?.classList.add('invalid');
      return 'Bitte eine Personenzahl zwischen 1 und 10 eingeben.';
    }
  } else {
    if (payload.household.annualConsumption_kwh == null) {
      annualConsumptionEl?.classList.add('invalid');
      return 'Bitte den absoluten Haushaltsverbrauch in kWh/Jahr eingeben.';
    }
    const annual = Number(payload.household.annualConsumption_kwh);
    if (!Number.isFinite(annual) || annual < 100 || annual > 200000) {
      annualConsumptionEl?.classList.add('invalid');
      return 'Der absolute Haushaltsverbrauch muss zwischen 100 und 200000 kWh/Jahr liegen.';
    }
  }

  const moduleDecision = determineModuleDecision();
  if (payload.tariff.largeLoadOver42kw && moduleDecision.requiresConsumptionChoice && !moduleDecision.hasConsumptionChoice) {
    return 'Bitte wählen Sie in der §14a-Abfrage die Grundcharakteristik (gering/normal oder sehr hoch). Die Verschiebbarkeit ist optional als Checkbox.';
  }

  if (payload.heatPump.hasHeatPump) {
    const hpConsumptionEl = byId('heatPumpConsumption');
    const hpCopEl = byId('heatPumpCop');
    hpConsumptionEl?.classList.remove('invalid');
    hpCopEl?.classList.remove('invalid');

    if (payload.heatPump.annualConsumption_kwh == null) {
      hpConsumptionEl?.classList.add('invalid');
      return 'Bitte den Wärmepumpen-Verbrauch in kWh/Jahr eingeben.';
    }
    if (payload.heatPump.cop == null) {
      hpCopEl?.classList.add('invalid');
      return 'Bitte den COP der Wärmepumpe eingeben.';
    }
  }

  const pvMode = document.querySelector('input[name="pvMode"]:checked').value;
  let rangeChecks = [
    { id: 'storageCapacity', min: 0, max: 100, active: payload.storage.hasStorage, label: 'Speicher' },
    { id: 'heatPumpConsumption', min: 0, max: 50000, active: payload.heatPump.hasHeatPump, label: 'Wärmepumpe-Verbrauch' },
    { id: 'heatPumpCop', min: 1, max: 8, active: payload.heatPump.hasHeatPump, label: 'Wärmepumpen-COP' }
  ];

  // Add PV-specific checks based on mode
  if (pvMode === 'known') {
    rangeChecks.push(
      { id: 'peakpower', min: 0.1, max: 1000, active: payload.pv.hasPv, label: 'PV-Leistung' }
    );
  } else if (pvMode === 'calculate') {
    rangeChecks.push(
      { id: 'roofArea', min: 1, max: 500, active: payload.pv.hasPv, label: 'Dachfläche' },
      { id: 'moduleEfficiency', min: 5, max: 25, active: payload.pv.hasPv, label: 'Moduleffizienz' },
      { id: 'angle', min: 0, max: 90, active: payload.pv.hasPv, label: 'Dachneigung' },
      { id: 'aspect', min: -180, max: 180, active: payload.pv.hasPv, label: 'Ausrichtung' }
    );
  }

  for (const check of rangeChecks) {
    const el = byId(check.id);
    el.classList.remove('invalid');
    if (!check.active) {
      continue;
    }

    const text = el.value.trim();
    if (!text) {
      continue;
    }

    const value = Number(text);
    if (Number.isNaN(value) || value < check.min || value > check.max) {
      el.classList.add('invalid');
      return `${check.label} muss zwischen ${check.min} und ${check.max} liegen.`;
    }
  }

  if (byId('hasEv').checked) {
    const vehicles = collectEvVehicles();
    if (!vehicles.length) {
      return 'Bitte mindestens ein E-Auto anlegen.';
    }

    const vehicleNodes = Array.from(document.querySelectorAll('.ev-vehicle'));
    for (let index = 0; index < vehicleNodes.length; index++) {
      const vehicleNode = vehicleNodes[index];
      const capacityEl = vehicleNode.querySelector('.ev-vehicle-capacity');
      const annualKmEl = vehicleNode.querySelector('.ev-vehicle-km');
      const wallboxEl = vehicleNode.querySelector('.ev-vehicle-wallbox');
      const chargeStartEl = vehicleNode.querySelector('.ev-vehicle-charging-start');
      const chargeEndEl = vehicleNode.querySelector('.ev-vehicle-charging-end');
      capacityEl.classList.remove('invalid');
      annualKmEl.classList.remove('invalid');
      wallboxEl.classList.remove('invalid');
      chargeStartEl?.classList.remove('invalid');
      chargeEndEl?.classList.remove('invalid');

      const capacity = Number(capacityEl.value);
      const annualKm = Number(annualKmEl.value);
      const wallbox = Number(wallboxEl.value);
      const chargeStart = Number(chargeStartEl?.value);
      const chargeEnd = Number(chargeEndEl?.value);
      
      if (!Number.isFinite(capacity) || capacity < 10 || capacity > 200) {
        capacityEl.classList.add('invalid');
        return `Batteriekapazität von E-Auto ${index + 1} muss zwischen 10 und 200 kWh liegen.`;
      }
      if (!Number.isFinite(annualKm) || annualKm < 100 || annualKm > 200000) {
        annualKmEl.classList.add('invalid');
        return `Jahreslaufleistung von E-Auto ${index + 1} muss zwischen 100 und 200000 km liegen.`;
      }
      if (!Number.isFinite(wallbox) || wallbox < 1.4 || wallbox > 22) {
        wallboxEl.classList.add('invalid');
        return `Wallbox-Leistung von E-Auto ${index + 1} muss zwischen 1,4 und 22 kW liegen.`;
      }
      if (!Number.isInteger(chargeStart) || chargeStart < 0 || chargeStart > 23) {
        chargeStartEl?.classList.add('invalid');
        return `Ladestunden-Start von E-Auto ${index + 1} muss zwischen 0 und 23 liegen.`;
      }
      if (!Number.isInteger(chargeEnd) || chargeEnd < 0 || chargeEnd > 23) {
        chargeEndEl?.classList.add('invalid');
        return `Ladestunden-End von E-Auto ${index + 1} muss zwischen 0 und 23 liegen.`;
      }
    }
  }

  if (byId('hasLargeLoad42')?.checked) {
    const loads = Array.from(document.querySelectorAll('.large-load'));
    const hasOtherLargeLoad = byId('hasOtherLargeLoad')?.checked === true;
    const hasAnyGrossConsumer = payload.heatPump.hasHeatPump || payload.emobility.hasEV || hasOtherLargeLoad;
    if (!hasAnyGrossConsumer) {
      return 'Bitte geben Sie mindestens einen Großverbraucher an: entweder Wärmepumpe, E-Auto oder ein anderes Gerät über 4,2 kW.';
    }

    if (!hasOtherLargeLoad) {
      return '';
    }

    if (!loads.length) {
      return 'Bitte mindestens ein weiteres Gerät über 4,2 kW hinzufügen oder die Auswahl auf "Nein" stellen.';
    }

    for (let index = 0; index < loads.length; index++) {
      const loadNode = loads[index];
      const powerEl = loadNode.querySelector('.large-load-power');
      const startEl = loadNode.querySelector('.large-load-start');
      const endEl = loadNode.querySelector('.large-load-end');
      const usageDaysEl = loadNode.querySelector('.large-load-usage-days');
      powerEl?.classList.remove('invalid');
      startEl?.classList.remove('invalid');
      endEl?.classList.remove('invalid');
      usageDaysEl?.classList.remove('invalid');

      const power = Number(powerEl?.value);
      const start = Number(startEl?.value);
      const end = Number(endEl?.value);
      const usageDays = Number(usageDaysEl?.value);

      if (!Number.isFinite(power) || power < 4.2 || power > 200) {
        powerEl?.classList.add('invalid');
        return `Leistung von Großverbraucher ${index + 1} muss zwischen 4,2 und 200 kW liegen.`;
      }
      if (!Number.isInteger(start) || start < 0 || start > 23) {
        startEl?.classList.add('invalid');
        return `Startstunde von Großverbraucher ${index + 1} muss zwischen 0 und 23 liegen.`;
      }
      if (!Number.isInteger(end) || end < 0 || end > 23) {
        endEl?.classList.add('invalid');
        return `Endstunde von Großverbraucher ${index + 1} muss zwischen 0 und 23 liegen.`;
      }
      if (!Number.isInteger(usageDays) || usageDays < 1 || usageDays > 7) {
        usageDaysEl?.classList.add('invalid');
        return `Nutzungstage von Großverbraucher ${index + 1} müssen zwischen 1 und 7 Tagen liegen.`;
      }
    }
  }

  return '';
}

function initEvVehicles() {
  if (!evVehiclesContainer || !addEvBtn) {
    return;
  }

  addEvBtn.addEventListener('click', () => {
    addEvVehicle();
    updateEvVehicleProfiles();
  });

  evVehiclesContainer.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.ev-remove-btn');
    if (!removeBtn) {
      return;
    }

    const card = removeBtn.closest('.ev-vehicle');
    if (card) {
      card.remove();
      renumberEvVehicles();
      updateEvVehicleProfiles();
    }
    ensureAtLeastOneEvVehicle();
  });
}

function addEvVehicle(vehicle = {}) {
  if (!evVehiclesContainer) {
    return;
  }

  const card = document.createElement('div');
  card.className = 'ev-vehicle';
  card.innerHTML = `
    <div class="ev-vehicle-head">
      <strong class="ev-vehicle-title">E-Auto</strong>
      <button type="button" class="ghost ev-remove-btn">Entfernen</button>
    </div>
    <div class="grid four">
      <label class="field">
        <span>Batteriekapazität (kWh) <button type="button" class="info-btn" data-info="evBattery">&#9432;</button></span>
        <input class="ev-vehicle-capacity" type="number" step="0.1" min="10" max="200" value="${vehicle.batteryCapacity_kwh ?? ''}" data-update="true">
      </label>
      <label class="field">
        <span>Jährliche Laufleistung (km) <button type="button" class="info-btn" data-info="evAnnualKm">&#9432;</button></span>
        <input class="ev-vehicle-km" type="number" step="100" min="100" max="200000" value="${vehicle.annualKm ?? ''}" data-update="true">
      </label>
      <label class="field">
        <span>Wallbox-Leistung (kW) <button type="button" class="info-btn" data-info="evWallbox">&#9432;</button></span>
        <input class="ev-vehicle-wallbox" type="number" step="0.1" min="1.4" max="22" value="${vehicle.wallboxPower_kw ?? ''}" data-update="true">
      </label>
      <label class="field toggle">
        <span>Bidirektionales Laden <button type="button" class="info-btn" data-info="bidi">&#9432;</button></span>
        <input class="ev-vehicle-bidi" type="checkbox" ${vehicle.useBidirectional ? 'checked' : ''}>
      </label>
    </div>
    <div class="grid two">
      <label class="field">
        <span>Ladestundenplan - Start (0-23) <button type="button" class="info-btn" data-info="evChargingStart">&#9432;</button></span>
        <input class="ev-vehicle-charging-start" type="number" step="1" min="0" max="23" value="${vehicle.chargingStartHour ?? 22}" data-update="true">
      </label>
      <label class="field">
        <span>Ladestundenplan - End (0-23) <button type="button" class="info-btn" data-info="evChargingEnd">&#9432;</button></span>
        <input class="ev-vehicle-charging-end" type="number" step="1" min="0" max="23" value="${vehicle.chargingEndHour ?? 6}" data-update="true">
      </label>
    </div>
  `;
  evVehiclesContainer.appendChild(card);
  
  // Add live update listener for EV profiles
  card.querySelectorAll('[data-update="true"]').forEach(input => {
    input.addEventListener('input', () => {
      updateEvVehicleProfiles();
    });
  });
  
  renumberEvVehicles();
}

function ensureAtLeastOneEvVehicle() {
  if (!byId('hasEv')?.checked || !evVehiclesContainer) {
    return;
  }

  if (!evVehiclesContainer.children.length) {
    addEvVehicle();
  }
}

function ensureAtLeastOneLargeLoad() {
  if (!byId('hasOtherLargeLoad')?.checked || !largeLoadsContainer) {
    return;
  }

  if (!largeLoadsContainer.children.length) {
    addLargeLoad();
  }
}

function updateLargeLoadProfiles() {
  if (!largeLoadProfileSection || !largeLoadProfilesContainer) {
    return;
  }

  const loads = collectLargeLoads();
  if (!loads.length) {
    largeLoadProfileSection.classList.add('hidden');
    return;
  }

  largeLoadProfileSection.classList.remove('hidden');
  
  // Typisches 24h Stundenpreisprofil für Deutschland (ct/kWh)
  // Simulates EPEX Spot prices: Nacht günstig, Morgen teuer, Mittag moderater, Abend wieder teuer
  const HOURLY_PRICES = [
    22, 21, 20, 18, 16, 20, 28, 35, 38, 40, 42, 44,  // 0-11h (Nacht günstig, Morgen teuer)
    45, 43, 40, 38, 35, 36, 38, 42, 45, 48, 50, 35   // 12-23h (Mittag/Abend, Nacht wieder günstiger)
  ];
  
  largeLoadProfilesContainer.innerHTML = '';
  
  loads.forEach((load, idx) => {
    const power = load.powerKw || 0;
    const startHour = load.startHour || 0;
    const endHour = load.endHour || 23;
    const usageDays = load.usageDays_perWeek || 5;
    
    // Prüfe ob über Mitternacht
    const hoursArray = startHour <= endHour
      ? Array.from({length: endHour - startHour}, (_, i) => startHour + i)
      : [...Array.from({length: 24 - startHour}, (_, i) => startHour + i), ...Array.from({length: endHour}, (_, i) => i)];
    
    // Berechne Kosten pro Stunde
    const hourlyData = hoursArray.map(hour => ({
      hour,
      price: HOURLY_PRICES[hour] || 30,
      consumption: power,
      cost: (power * HOURLY_PRICES[hour] / 100)
    }));
    
    // Tageskosten
    const dailyCost = hourlyData.reduce((sum, h) => sum + h.cost, 0);
    const weeklyCost = dailyCost * usageDays;
    const yearlyCost = weeklyCost * 52;
    
    const profileDiv = document.createElement('div');
    profileDiv.className = 'large-load-profile-card';
    profileDiv.innerHTML = `
      <h3 style="margin:0.5rem 0; font-size:1rem">Großverbraucher ${idx + 1}: ${startHour}:00 - ${endHour}:00 Uhr (${usageDays}x/Woche)</h3>
      <details style="margin-top:0.5rem">
        <summary style="cursor:pointer; padding:0.4rem 0.6rem; background:#f0f0f0; border-radius:4px; font-size:0.85rem; user-select:none">Stundenprofil anzeigen ▾</summary>
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-top:0.4rem">
          <thead>
            <tr style="border-bottom:1px solid #ccc; background:#f9f9f9">
              <th style="text-align:center; padding:0.4rem; width:10%">Stunde</th>
              <th style="text-align:right; padding:0.4rem; width:20%">Preis (ct/kWh)</th>
              <th style="text-align:right; padding:0.4rem; width:20%">Verbrauch</th>
              <th style="text-align:right; padding:0.4rem; width:20%">Kosten/Stunde</th>
            </tr>
          </thead>
          <tbody>
            ${hourlyData.map(h => {
              const isExpensive = h.price > 40;
              const isCheap = h.price < 25;
              let rowStyle = 'background:#fff';
              if (isCheap) rowStyle = 'background:#e8f5e9';
              if (isExpensive) rowStyle = 'background:#ffebee';
              return `
                <tr style="border-bottom:1px solid #eee; ${rowStyle}">
                  <td style="text-align:center; padding:0.4rem;">${h.hour.toString().padStart(2, '0')}:00</td>
                  <td style="text-align:right; padding:0.4rem;">${h.price}</td>
                  <td style="text-align:right; padding:0.4rem;">${h.consumption.toFixed(1)} kW</td>
                  <td style="text-align:right; padding:0.4rem; font-weight:bold">€${h.cost.toFixed(2)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </details>
      <div style="margin-top:0.5rem; padding:0.75rem; background:#f5f5f5; border-radius:4px; font-size:0.9rem">
        <strong>📊 Tägliche Kosten:</strong> €${dailyCost.toFixed(2)} | 
        <strong>📅 Wöchentlich:</strong> €${weeklyCost.toFixed(2)} | 
        <strong>📈 Jährlich (ca.):</strong> <span style="color:#d32f2f; font-weight:bold">€${yearlyCost.toFixed(0)}</span>
      </div>
    `;
    largeLoadProfilesContainer.appendChild(profileDiv);
  });
}

function updateEvVehicleProfiles() {
  if (!evProfileSection || !evProfilesContainer) {
    return;
  }

  const vehicles = collectEvVehicles();
  if (!vehicles.length || !byId('hasEv')?.checked) {
    evProfileSection.classList.add('hidden');
    return;
  }

  evProfileSection.classList.remove('hidden');
  
  // Typisches 24h Stundenpreisprofil für Deutschland (ct/kWh)
  // Simulates EPEX Spot prices: Nacht günstig, Morgen teuer, Mittag moderater, Abend wieder teuer
  const HOURLY_PRICES = [
    22, 21, 20, 18, 16, 20, 28, 35, 38, 40, 42, 44,  // 0-11h (Nacht günstig, Morgen teuer)
    45, 43, 40, 38, 35, 36, 38, 42, 45, 48, 50, 35   // 12-23h (Mittag/Abend, Nacht wieder günstiger)
  ];
  
  evProfilesContainer.innerHTML = '';
  
  vehicles.forEach((vehicle, idx) => {
    const wallboxPower = vehicle.wallboxPower_kw || 11;
    const battery = vehicle.batteryCapacity_kwh || 60;
    const startHour = vehicle.chargingStartHour || 22;
    const endHour = vehicle.chargingEndHour || 6;
    
    // Ladedauer in Stunden bei typischem Laden (z.B. 60 kWh / 11 kW = ~5.5h)
    const chargeTimeHours = battery / wallboxPower;
    
    // Jahresladezyklen aus Laufleistung: ~300 km Reichweite pro Vollladung
    const annualChargingEvents = Math.round((vehicle.annualKm || 12000) / 300);
    
    // Prüfe ob über Mitternacht
    const hoursArray = startHour <= endHour
      ? Array.from({length: endHour - startHour}, (_, i) => startHour + i)
      : [...Array.from({length: 24 - startHour}, (_, i) => startHour + i), ...Array.from({length: endHour}, (_, i) => i)];
    
    // Berechne Kosten pro Stunde
    const hourlyData = hoursArray.map(hour => ({
      hour,
      price: HOURLY_PRICES[hour] || 30,
      power: wallboxPower,
      energyKwh: wallboxPower,
      cost: (wallboxPower * HOURLY_PRICES[hour] / 100)
    }));
    
    // Kosten pro Ladesession (Vollladung)
    const costPerSession = hourlyData.reduce((sum, h) => sum + h.cost, 0);
    // Jahreskosten rein aus km-basierter Anzahl Ladevorgänge
    const yearlyCost = costPerSession * annualChargingEvents;
    
    const profileDiv = document.createElement('div');
    profileDiv.className = 'large-load-profile-card';
    profileDiv.innerHTML = `
      <h3 style="margin:0.5rem 0; font-size:1rem">E-Auto ${idx + 1}: ${startHour}:00 - ${endHour}:00 Uhr | ca. ${annualChargingEvents} Ladevorgänge/Jahr</h3>
      <p style="margin:0.3rem 0; font-size:0.85rem; color:#666">Batterie: ${battery} kWh | Wallbox: ${wallboxPower} kW | Ladedauer: ~${chargeTimeHours.toFixed(1)}h | Laufleistung: ${vehicle.annualKm || 12000} km/Jahr</p>
      <details style="margin-top:0.5rem">
        <summary style="cursor:pointer; padding:0.4rem 0.6rem; background:#f0f0f0; border-radius:4px; font-size:0.85rem; user-select:none">Stundenprofil anzeigen ▾</summary>
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-top:0.4rem">
          <thead>
            <tr style="border-bottom:1px solid #ccc; background:#f9f9f9">
              <th style="text-align:center; padding:0.4rem; width:10%">Stunde</th>
              <th style="text-align:right; padding:0.4rem; width:20%">Preis (ct/kWh)</th>
              <th style="text-align:right; padding:0.4rem; width:20%">Leistung</th>
              <th style="text-align:right; padding:0.4rem; width:20%">Kosten/Stunde</th>
            </tr>
          </thead>
          <tbody>
            ${hourlyData.map(h => {
              const isExpensive = h.price > 40;
              const isCheap = h.price < 25;
              let rowStyle = 'background:#fff';
              if (isCheap) rowStyle = 'background:#e8f5e9';
              if (isExpensive) rowStyle = 'background:#ffebee';
              return `
                <tr style="border-bottom:1px solid #eee; ${rowStyle}">
                  <td style="text-align:center; padding:0.4rem;">${h.hour.toString().padStart(2, '0')}:00</td>
                  <td style="text-align:right; padding:0.4rem;">${h.price}</td>
                  <td style="text-align:right; padding:0.4rem;">${h.power.toFixed(1)} kW</td>
                  <td style="text-align:right; padding:0.4rem; font-weight:bold">€${h.cost.toFixed(2)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </details>
      <div style="margin-top:0.5rem; padding:0.75rem; background:#f5f5f5; border-radius:4px; font-size:0.9rem">
        <strong>🔋 Kosten pro Ladesession:</strong> €${costPerSession.toFixed(2)} | 
        <strong>📈 Jährlich (${annualChargingEvents} Ladevorgänge):</strong> <span style="color:#2196f3; font-weight:bold">€${yearlyCost.toFixed(0)}</span>
      </div>
    `;
    evProfilesContainer.appendChild(profileDiv);
  });
}

function renumberEvVehicles() {
  const titles = evVehiclesContainer?.querySelectorAll('.ev-vehicle-title') || [];
  const removeButtons = evVehiclesContainer?.querySelectorAll('.ev-remove-btn') || [];
  titles.forEach((title, index) => {
    title.textContent = `E-Auto ${index + 1}`;
  });
  removeButtons.forEach((button) => {
    button.disabled = removeButtons.length <= 1 && byId('hasEv')?.checked;
  });
}

function collectEvVehicles() {
  return Array.from(document.querySelectorAll('.ev-vehicle')).map((vehicleNode) => ({
    batteryCapacity_kwh: Number(vehicleNode.querySelector('.ev-vehicle-capacity')?.value),
    annualKm: Number(vehicleNode.querySelector('.ev-vehicle-km')?.value),
    wallboxPower_kw: Number(vehicleNode.querySelector('.ev-vehicle-wallbox')?.value),
    consumption_kwh_per_100km: 20,
    useBidirectional: Boolean(vehicleNode.querySelector('.ev-vehicle-bidi')?.checked),
    chargingStartHour: Number(vehicleNode.querySelector('.ev-vehicle-charging-start')?.value) || 22,
    chargingEndHour: Number(vehicleNode.querySelector('.ev-vehicle-charging-end')?.value) || 6
  }));
}

function initLargeLoads() {
  if (!largeLoadsContainer || !addLargeLoadBtn) {
    return;
  }

  addLargeLoadBtn.addEventListener('click', () => {
    addLargeLoad();
    updateLargeLoadProfiles();
  });

  largeLoadsContainer.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.large-load-remove-btn');
    if (!removeBtn) {
      return;
    }

    const card = removeBtn.closest('.large-load');
    if (card) {
      card.remove();
      renumberLargeLoads();
      updateLargeLoadProfiles();
    }
  });

  largeLoadsContainer.addEventListener('input', () => {
    updateLargeLoadProfiles();
  });
}

function addLargeLoad(load = {}) {
  if (!largeLoadsContainer) {
    return;
  }

  const power = load.powerKw ?? '';
  const startHour = load.startHour ?? 22;
  const endHour = load.endHour ?? 6;
  const usageDays = load.usageDays_perWeek ?? 5;
  
  const durationHours = startHour <= endHour 
    ? (endHour - startHour) 
    : (24 - startHour + endHour);
  const estimatedAnnualKwh = (power && durationHours > 0) ? (power * durationHours * usageDays * 52).toFixed(0) : '—';
  
  const card = document.createElement('div');
  card.className = 'large-load';
  card.innerHTML = `
    <div class="ev-vehicle-head">
      <strong class="large-load-title">Großverbraucher</strong>
      <button type="button" class="ghost large-load-remove-btn">Entfernen</button>
    </div>
    <div class="grid four">
      <label class="field">
        <span>Leistung (kW) <button type="button" class="info-btn" data-info="largeLoadPower">&#9432;</button></span>
        <input class="large-load-power" type="number" step="0.1" min="4.2" max="200" value="${power}" data-update="true">
      </label>
      <label class="field">
        <span>Startstunde (0-23) <button type="button" class="info-btn" data-info="largeLoadStart">&#9432;</button></span>
        <input class="large-load-start" type="number" step="1" min="0" max="23" value="${startHour}" data-update="true">
      </label>
      <label class="field">
        <span>Endstunde (0-23) <button type="button" class="info-btn" data-info="largeLoadEnd">&#9432;</button></span>
        <input class="large-load-end" type="number" step="1" min="0" max="23" value="${endHour}" data-update="true">
      </label>
      <label class="field">
        <span>Tage pro Woche <button type="button" class="info-btn" data-info="largeLoadUsageDays">&#9432;</button></span>
        <input class="large-load-usage-days" type="number" step="1" min="1" max="7" value="${usageDays}" data-update="true">
      </label>
    </div>
    <div class="field note-box" style="margin-top:0.6rem">
      <span>Geschätzter Jahresverbrauch</span>
      <strong class="large-load-annual-kwh">${estimatedAnnualKwh}</strong> kWh/Jahr
    </div>
  `;

  largeLoadsContainer.appendChild(card);
  
  // Add live update listener
  card.querySelectorAll('[data-update="true"]').forEach(input => {
    input.addEventListener('input', () => {
      const power = Number(card.querySelector('.large-load-power')?.value) || 0;
      const startHour = Number(card.querySelector('.large-load-start')?.value) || 0;
      const endHour = Number(card.querySelector('.large-load-end')?.value) || 23;
      const usageDays = Number(card.querySelector('.large-load-usage-days')?.value) || 5;
      const durationHours = startHour <= endHour 
        ? (endHour - startHour) 
        : (24 - startHour + endHour);
      const annual = (power && durationHours > 0) ? (power * durationHours * usageDays * 52).toFixed(0) : '—';
      card.querySelector('.large-load-annual-kwh').textContent = annual;
      updateLargeLoadProfiles();
    });
  });
  
  renumberLargeLoads();
}

function renumberLargeLoads() {
  const titles = largeLoadsContainer?.querySelectorAll('.large-load-title') || [];
  const removeButtons = largeLoadsContainer?.querySelectorAll('.large-load-remove-btn') || [];
  titles.forEach((title, index) => {
    title.textContent = `Großverbraucher ${index + 1}`;
  });
  removeButtons.forEach((button) => {
    button.disabled = false;
  });
}

function collectLargeLoads() {
  return Array.from(document.querySelectorAll('.large-load')).map((loadNode) => {
    const power = Number(loadNode.querySelector('.large-load-power')?.value) || 0;
    const startHour = Number(loadNode.querySelector('.large-load-start')?.value) || 0;
    const endHour = Number(loadNode.querySelector('.large-load-end')?.value) || 23;
    const usageDays = Number(loadNode.querySelector('.large-load-usage-days')?.value) || 5;
    const durationHours = startHour <= endHour 
      ? (endHour - startHour) 
      : (24 - startHour + endHour);
    return {
      powerKw: power,
      startHour,
      endHour,
      usageDays_perWeek: usageDays,
      annualConsumption_kwh: power * durationHours * usageDays * 52
    };
  });
}

function buildLargeLoadDailyCurveKw(loads) {
  const curve = Array.from({ length: 24 }, () => 0);
  loads.forEach((load) => {
    if (!Number.isFinite(load.powerKw) || load.powerKw <= 0) {
      return;
    }
    const start = Number.isInteger(load.startHour) ? load.startHour : 0;
    const end = Number.isInteger(load.endHour) ? load.endHour : start;
    for (let h = 0; h < 24; h++) {
      const active = start === end ? true : (start < end ? (h >= start && h < end) : (h >= start || h < end));
      if (active) {
        curve[h] += load.powerKw;
      }
    }
  });
  return curve.map((value) => Math.round(value * 100) / 100);
}

function optionalNumber(id) {
  const raw = byId(id).value.trim();
  return raw === '' ? null : Number(raw);
}

function setSectionEnabled(targetDiv, enabled) {
  targetDiv.classList.toggle('disabled', !enabled);

  const controls = targetDiv.querySelectorAll('input, select, textarea, button');
  controls.forEach((control) => {
    if (control.classList.contains('info-btn')) {
      return;
    }
    control.disabled = !enabled;
  });

  scheduleWizardHeightSync();
}

function setFieldsetActiveState(toggleEl, enabled) {
  const fieldset = toggleEl.closest('fieldset');
  if (!fieldset) {
    return;
  }
  fieldset.classList.toggle('is-active', enabled);
}

function unlockAllFormInputs() {
  if (!form) {
    return;
  }
  const editableControls = form.querySelectorAll('input, select, textarea');
  editableControls.forEach((control) => {
    control.removeAttribute('readonly');
  });
}

function initHouseholdConsumptionMode() {
  const consumptionKnownEl = byId('consumptionKnown');
  const personsInput = byId('persons');
  const annualConsumptionInput = byId('householdAnnualConsumption');
  const consumptionKnownFields = byId('consumptionKnownFields');
  const personsFieldsEl = byId('personsFields');
  if (!consumptionKnownEl || !personsInput || !annualConsumptionInput) {
    return;
  }

  const sync = () => {
    const known = consumptionKnownEl.checked;
    consumptionKnownFields?.classList.toggle('hidden', !known);
    personsFieldsEl?.classList.toggle('hidden', known);
    personsInput.required = !known;
    annualConsumptionInput.required = known;
    scheduleWizardHeightSync();
  };

  consumptionKnownEl.addEventListener('change', sync);
  sync();
}

function initModuleDecisionFlow() {
  const largeLoadToggle = byId('hasLargeLoad42');
  const shiftableToggle = byId('moduleShiftable');
  if (!largeLoadToggle || !moduleConditionBlock || !moduleDecisionResult || !installedBefore2024 || !allowsGridControl || !controlConsentBlock || !consumptionChoiceBlock || !moduleConsumptionPattern || !shiftableToggle) {
    return;
  }

  const consumptionButtons = Array.from(document.querySelectorAll('.module-choice-btn'));
  consumptionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const pattern = button.dataset.pattern || '';
      moduleConsumptionPattern.value = pattern;
      syncModuleConsumptionButtons(pattern);
      syncModuleDecisionFlow();
    });
  });

  [largeLoadToggle, installedBefore2024, allowsGridControl, shiftableToggle].forEach((el) => {
    el.addEventListener('change', syncModuleDecisionFlow);
  });

  syncModuleDecisionFlow();
}

function syncModuleDecisionFlow() {
  const largeLoadToggle = byId('hasLargeLoad42');
  const shiftableToggle = byId('moduleShiftable');
  const hasLargeLoad = largeLoadToggle?.checked === true;
  const isBefore2024 = installedBefore2024?.checked === true;
  const allowsControl = allowsGridControl?.checked === true;

  moduleConditionBlock?.classList.toggle('hidden', !hasLargeLoad);
  if (!hasLargeLoad) {
    if (installedBefore2024) installedBefore2024.checked = false;
    if (allowsGridControl) allowsGridControl.checked = false;
    if (shiftableToggle) shiftableToggle.checked = false;
    if (moduleConsumptionPattern) moduleConsumptionPattern.value = '';
    syncModuleConsumptionButtons('');
    syncDecisionButtons('installedBefore2024', false);
    syncDecisionButtons('allowsGridControl', false);
  }

  // Grid control consent is only relevant for devices installed BEFORE 2024.
  // After 2024 the new §14a mandate applies automatically — no need to ask.
  const needsConsent = hasLargeLoad && isBefore2024;
  controlConsentBlock?.classList.toggle('hidden', !needsConsent);
  if (!isBefore2024) {
    if (allowsGridControl) allowsGridControl.checked = false;
    syncDecisionButtons('allowsGridControl', false);
  }

  const canProceedToConsumption = hasLargeLoad && (!isBefore2024 || allowsControl);
  consumptionChoiceBlock?.classList.toggle('hidden', !canProceedToConsumption);
  if (!canProceedToConsumption) {
    if (moduleConsumptionPattern) {
      moduleConsumptionPattern.value = '';
      syncModuleConsumptionButtons('');
    }
    if (shiftableToggle) {
      shiftableToggle.checked = false;
    }
  }

  const decision = determineModuleDecision();
  if (!moduleDecisionResult) {
    return;
  }
  moduleDecisionResult.textContent = decision.message;
  scheduleWizardHeightSync();
}

function syncModuleConsumptionButtons(pattern) {
  const buttons = Array.from(document.querySelectorAll('.module-choice-btn'));
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.pattern === pattern);
  });
}

function determineModuleDecision() {
  const hasLargeLoad = byId('hasLargeLoad42')?.checked === true;
  const isBefore2024 = installedBefore2024?.checked === true;
  const allowsControl = allowsGridControl?.checked === true;
  const pattern = moduleConsumptionPattern?.value || '';
  const isShiftable = byId('moduleShiftable')?.checked === true;

  if (!hasLargeLoad) {
    return {
      module: 'none',
      requiresConsumptionChoice: false,
      hasConsumptionChoice: false,
      message: 'Module nicht relevant: Keine Geräte über 4,2 kW im Haushalt.'
    };
  }

  if (isBefore2024 && !allowsControl) {
    return {
      module: 'none',
      requiresConsumptionChoice: false,
      hasConsumptionChoice: false,
      message: 'Module nicht relevant: Steuerung durch Netzbetreiber wurde abgelehnt.'
    };
  }

  // Official baseline from BNetzA: Modul 1 = pauschaler Rabatt (default/robust).
  if (isShiftable) {
    return {
      module: 'modul3',
      requiresConsumptionChoice: true,
      hasConsumptionChoice: true,
      message: 'Empfohlen: Modul 3 (zeitvariables Netzentgelt; sinnvoll bei gut verschiebbaren Lasten, Smart Meter/EMS empfehlenswert).'
    };
  }

  if (pattern === 'high') {
    return {
      module: 'modul2',
      requiresConsumptionChoice: true,
      hasConsumptionChoice: true,
      message: 'Empfohlen: Modul 2 (60 % Reduktion des Arbeitspreis-Netzentgeltanteils; separater Zählpunkt nötig, oft stark bei hohem Verbrauch).'
    };
  }

  if (pattern === 'low') {
    return {
      module: 'modul1',
      requiresConsumptionChoice: true,
      hasConsumptionChoice: true,
      message: 'Empfohlen: Modul 1 (pauschaler Netzentgelt-Rabatt; stabil und meist sinnvoll bei geringem bis normalem Zusatzverbrauch).'
    };
  }

  return {
    module: 'none',
    requiresConsumptionChoice: true,
    hasConsumptionChoice: false,
    message: 'Bitte wählen Sie die Grundcharakteristik (gering/normal oder sehr hoch). Optional können Sie zusätzlich Verschiebbarkeit aktivieren.'
  };
}

function initDecisionButtons() {
  const groups = document.querySelectorAll('.decision-toggle[data-toggle-id]');
  groups.forEach((group) => {
    const toggleId = group.dataset.toggleId;
    const toggle = byId(toggleId);
    if (!toggle) {
      return;
    }

    const buttons = group.querySelectorAll('.decision-btn');
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.dataset.value === 'true';
        if (toggle.checked === value) {
          syncDecisionButtons(toggleId, value);
          return;
        }
        toggle.checked = value;
        syncDecisionButtons(toggleId, value);
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    syncDecisionButtons(toggleId, toggle.checked);
  });
}

function syncDecisionButtons(toggleId, state) {
  const group = document.querySelector(`.decision-toggle[data-toggle-id="${toggleId}"]`);
  if (!group) {
    return;
  }
  const buttons = group.querySelectorAll('.decision-btn');
  buttons.forEach((button) => {
    const buttonValue = button.dataset.value === 'true';
    button.classList.toggle('active', buttonValue === state);
  });
}

function initWizard() {
  if (!wizardStage || !wizardPrev || !wizardNext) {
    return;
  }

  wizardState.steps = Array.from(wizardStage.querySelectorAll('.wizard-step'));
  if (!wizardState.steps.length) {
    return;
  }

  wizardState.currentIndex = 0;
  wizardState.steps.forEach((step, index) => {
    step.classList.remove('is-mounted', 'is-active', 'enter-from-right', 'enter-from-left', 'leave-to-left', 'leave-to-right');
    if (index === 0) {
      step.classList.add('is-mounted', 'is-active');
    }
  });

  updateWizardUi();
  startWizardLayoutObservers();
  scheduleWizardHeightSync();

  wizardPrev.addEventListener('click', () => {
    goToWizardStep(wizardState.currentIndex - 1, 'backward');
  });

  wizardNext.addEventListener('click', () => {
    goToWizardStep(wizardState.currentIndex + 1, 'forward');
  });

  window.addEventListener('resize', syncWizardHeight);
}

function startWizardLayoutObservers() {
  if (!wizardStage) {
    return;
  }

  if (wizardResizeObserver) {
    wizardResizeObserver.disconnect();
  }

  if (typeof ResizeObserver !== 'undefined') {
    wizardResizeObserver = new ResizeObserver(() => {
      syncWizardHeight();
    });

    wizardState.steps.forEach((step) => {
      wizardResizeObserver.observe(step);
    });
  }

  if (wizardMutationObserver) {
    wizardMutationObserver.disconnect();
  }

  if (typeof MutationObserver !== 'undefined') {
    wizardMutationObserver = new MutationObserver(() => {
      syncWizardHeight();
    });

    wizardMutationObserver.observe(wizardStage, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style']
    });
  }
}

function scheduleWizardHeightSync() {
  requestAnimationFrame(syncWizardHeight);
  window.setTimeout(syncWizardHeight, 140);
}

function isWizardOnLastStep() {
  if (!wizardState.steps.length) {
    return true;
  }
  return wizardState.currentIndex >= wizardState.steps.length - 1;
}

function goToWizardStep(targetIndex, direction = 'forward') {
  if (!wizardState.steps.length) {
    return false;
  }

  const maxIndex = wizardState.steps.length - 1;
  let clampedTarget = Math.max(0, Math.min(targetIndex, maxIndex));

  // Skip the "Großverbraucher" step unless §14a large-load question is answered with yes.
  const hasLargeLoad = byId('hasLargeLoad42')?.checked === true;
  while (
    clampedTarget > 0
    && clampedTarget < maxIndex
    && wizardState.steps[clampedTarget]?.dataset?.stepTitle === 'Großverbraucher'
    && !hasLargeLoad
  ) {
    clampedTarget += direction === 'backward' ? -1 : 1;
  }

  clampedTarget = Math.max(0, Math.min(clampedTarget, maxIndex));
  if (clampedTarget === wizardState.currentIndex) {
    return false;
  }

  if (direction === 'forward' && !validateWizardStep(wizardState.currentIndex)) {
    return false;
  }

  const currentStep = wizardState.steps[wizardState.currentIndex];
  const nextStep = wizardState.steps[clampedTarget];
  const enteringClass = direction === 'forward' ? 'enter-from-right' : 'enter-from-left';
  const leavingClass = direction === 'forward' ? 'leave-to-left' : 'leave-to-right';

  nextStep.classList.remove('enter-from-right', 'enter-from-left', 'leave-to-left', 'leave-to-right', 'is-active', 'is-mounted');
  nextStep.classList.add('is-mounted', enteringClass);

  requestAnimationFrame(() => {
    currentStep.classList.remove('leave-to-left', 'leave-to-right');
    currentStep.classList.add(leavingClass);
    currentStep.classList.remove('is-active');

    nextStep.classList.add('is-active');
    nextStep.classList.remove(enteringClass);
    syncWizardHeight();
  });

  window.setTimeout(() => {
    currentStep.classList.remove('is-mounted', 'leave-to-left', 'leave-to-right', 'enter-from-right', 'enter-from-left');
    syncWizardHeight();
  }, WIZARD_ANIMATION_MS + 20);

  wizardState.currentIndex = clampedTarget;
  updateWizardUi();
  clearError();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}

function validateWizardStep(index) {
  const step = wizardState.steps[index];
  if (!step) {
    return true;
  }

  const fields = Array.from(step.querySelectorAll('input, select, textarea')).filter((field) => {
    if (field.disabled || field.type === 'hidden') {
      return false;
    }
    return true;
  });

  for (const field of fields) {
    if (field.willValidate && !field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }

  const stepTitle = step.dataset.stepTitle || '';
  if (stepTitle === 'Großverbraucher' && byId('hasLargeLoad42')?.checked) {
    const hasHeatPump = byId('hasHeatPump')?.checked === true;
    const hasEv = byId('hasEv')?.checked === true;
    const hasOtherLargeLoad = byId('hasOtherLargeLoad')?.checked === true;

    if (!hasHeatPump && !hasEv && !hasOtherLargeLoad) {
      showError('Bitte mindestens einen Großverbraucher auswählen: Wärmepumpe, E-Auto oder ein weiteres Gerät über 4,2 kW.');
      return false;
    }

    if (hasEv && !collectEvVehicles().length) {
      showError('Bitte mindestens ein E-Auto erfassen oder E-Auto auf "Nein" stellen.');
      return false;
    }

    if (hasOtherLargeLoad && !collectLargeLoads().length) {
      showError('Bitte mindestens ein weiteres Gerät über 4,2 kW erfassen oder die Auswahl auf "Nein" stellen.');
      return false;
    }
  }

  return true;
}

function syncWizardHeight() {
  if (!wizardStage || !wizardState.steps.length) {
    return;
  }
  const activeStep = wizardState.steps[wizardState.currentIndex];
  if (!activeStep) {
    return;
  }
  const measuredHeight = Math.max(activeStep.offsetHeight, activeStep.scrollHeight);
  if (measuredHeight > 40) {
    wizardStage.style.height = `${measuredHeight}px`;
    wizardStage.style.minHeight = `${measuredHeight}px`;
  }
}

function updateWizardUi() {
  if (!wizardState.steps.length) {
    return;
  }

  const total = wizardState.steps.length;
  const current = wizardState.currentIndex + 1;
  const isLast = wizardState.currentIndex === total - 1;
  const title = wizardState.steps[wizardState.currentIndex].dataset.stepTitle || 'Eingaben';
  const percent = (current / total) * 100;

  if (wizardStepLabel) {
    wizardStepLabel.textContent = `Schritt ${current} von ${total}`;
  }
  if (wizardStepTitle) {
    wizardStepTitle.textContent = title;
  }
  if (wizardProgressFill) {
    wizardProgressFill.style.width = `${percent}%`;
    wizardProgressFill.parentElement?.setAttribute('aria-valuenow', String(current));
    wizardProgressFill.parentElement?.setAttribute('aria-valuemax', String(total));
  }

  if (wizardPrev) {
    wizardPrev.disabled = wizardState.currentIndex === 0;
  }
  if (wizardNext) {
    wizardNext.disabled = isLast;
    wizardNext.textContent = isLast ? 'Letzter Schritt' : 'Weiter';
  }
}

function setLoading(loading) {
  calcBtn.disabled = loading;
  btnLabel.classList.toggle('hidden', loading);
  btnLoading.classList.toggle('hidden', !loading);
  if (wizardPrev) {
    wizardPrev.disabled = loading || wizardState.currentIndex === 0;
  }
  if (wizardNext) {
    wizardNext.disabled = loading || isWizardOnLastStep();
  }
}

function renderResults(data) {
  const visibleTariffs = getVisibleTariffsForSelectedModule(data.tariffs || []);
  const best = pickBestTariff(visibleTariffs);
  const summary = data.summary || {};
  const used = data.usedParams || {};
  const moduleDecision = determineModuleDecision();
  const recommendedTariff = best?.label || summary.recommendedTariff || '-';
  const recommendedModule = formatSelectedModuleLabel(moduleDecision.module);

  byId('resRecommendation').innerHTML = `Tarif: <strong>${escapeHtml(recommendedTariff)}</strong><br>Modul: <strong>${escapeHtml(recommendedModule)}</strong>`;
  byId('resConsumption').textContent = `${formatNumber(summary.totalConsumption_kwh)} kWh`;
  byId('resYield').textContent = `${formatNumber(summary.pvYield_kwh)} kWh`;
  byId('resSaving').textContent = formatEuro(summary.annualSavingVsStatic_eur);

  const coords = used.coordinates || { lat: '-', lon: '-' };
  byId('resCoords').textContent = `${coords.lat}, ${coords.lon}`;
  byId('resBuilding').textContent = used.buildingType || 'EFH';
  byId('resBidi').textContent = used.bidiEnabled ? `aktiv (${formatNumber(used.bidiShifted_kwh)} kWh)` : 'aus';

  const ub = summary.uncertaintyBand_eur || {};
  byId('resUncertainty').textContent = `${formatEuro(ub.bestCase)} / ${formatEuro(ub.expected)} / ${formatEuro(ub.worstCase)}`;

  renderTariffTable(visibleTariffs);
  renderTransparency(data.dataTransparency || []);
  renderCharts(data);
  startMarketTicker();
}

function getVisibleTariffsForSelectedModule(tariffs) {
  const decision = determineModuleDecision();
  const selectedModule = decision.module;
  const hasLargeLoad = byId('hasLargeLoad42')?.checked === true;
  const normalized = Array.isArray(tariffs) ? tariffs : [];

  // If no module applies, show only non-14a variants.
  if (!hasLargeLoad || selectedModule === 'none') {
    return normalized.filter((tariff) => !String(tariff?.label || '').includes('§14a Modul'));
  }

  const selectedNeedle = selectedModule === 'modul1'
    ? 'Modul 1'
    : selectedModule === 'modul2'
      ? 'Modul 2'
      : 'Modul 3';

  // Keep baseline variants plus the explicitly selected module.
  const filtered = normalized.filter((tariff) => {
    const label = String(tariff?.label || '');
    if (!label.includes('§14a Modul')) {
      return true;
    }
    return label.includes(selectedNeedle);
  });

  return filtered.length ? filtered : normalized;
}

function pickBestTariff(tariffs) {
  if (!Array.isArray(tariffs) || !tariffs.length) {
    return null;
  }

  const flagged = tariffs.find((tariff) => tariff.recommended);
  if (flagged) {
    return flagged;
  }

  return tariffs.reduce((best, current) => {
    if (!best) return current;
    const bestCost = Number(best.netCost_eur);
    const currentCost = Number(current.netCost_eur);
    if (!Number.isFinite(currentCost)) {
      return best;
    }
    if (!Number.isFinite(bestCost) || currentCost < bestCost) {
      return current;
    }
    return best;
  }, null);
}

function formatSelectedModuleLabel(moduleKey) {
  if (moduleKey === 'modul1') {
    return '§14a Modul 1';
  }
  if (moduleKey === 'modul2') {
    return '§14a Modul 2';
  }
  if (moduleKey === 'modul3') {
    return '§14a Modul 3';
  }
  return 'Kein §14a-Modul';
}

async function startMarketTicker() {
  if (!marketTickerCurrent || !marketTickerWindow) {
    return;
  }

  if (!marketTickerHistoryLoaded) {
    await loadMarketTickerHistory();
    marketTickerHistoryLoaded = true;
  }

  // Always fetch current live value immediately so "Aktuell" is never stale or empty.
  await updateMarketTicker(true);

  if (marketTickerSamples.length) {
    renderTickerTrend();
  }

  scheduleMarketTicker();
}

function stopMarketTicker() {
  clearMarketTickerTimer();
}

function clearMarketTickerTimer() {
  if (marketTickerTimer) {
    clearTimeout(marketTickerTimer);
    marketTickerTimer = null;
  }
}

function scheduleMarketTicker() {
  clearMarketTickerTimer();
  const waitMs = msUntilNextFullHour() + MARKET_TICKER_SYNC_DELAY_MS;
  marketTickerTimer = setTimeout(async () => {
    await updateMarketTicker();
    scheduleMarketTicker();
  }, waitMs);
}

function msUntilNextFullHour() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  const diff = next.getTime() - now.getTime();
  return Math.max(1000, Math.min(MARKET_TICKER_INTERVAL_MS, diff));
}

async function updateMarketTicker(force = false) {
  if (!marketTickerCurrent || !marketTickerWindow) {
    return;
  }
  if (marketTickerBusy && !force) {
    return;
  }

  marketTickerBusy = true;
  setTickerStatus('Live-Marktdaten werden aktualisiert ...');

  try {
    const { response } = await apiFetch('/market-live', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || 'Live-Marktdaten nicht verfügbar.');
    }

    const market = result.data || {};
    const currentCt = Number(market.current_ct_per_kwh);
    const currentDynamicCt = Number(market.dynamic_current_ct_per_kwh);
    const startsAt = market.startsAt ? new Date(market.startsAt) : null;
    const endsAt = market.endsAt ? new Date(market.endsAt) : null;

    if (!Number.isFinite(currentCt)) {
      throw new Error('Ungültiger Marktpreis empfangen.');
    }

    addTickerSample({
      at: startsAt || new Date(),
      valueCt: currentCt
    });

    marketTickerCurrent.textContent = `${formatCtPerKwh(currentCt)} ct/kWh`;
    if (marketTickerDynamicCurrent) {
      marketTickerDynamicCurrent.textContent = Number.isFinite(currentDynamicCt)
        ? `${formatCtPerKwh(currentDynamicCt)} ct/kWh`
        : '-';
    }
    marketTickerWindow.textContent = startsAt && endsAt
      ? `${formatDateTime(startsAt)} - ${formatDateTime(endsAt)}`
      : '-';

    renderTickerTrend();

    const updatedAt = formatDateTime(new Date());
    const nextAt = new Date(Date.now() + msUntilNextFullHour() + MARKET_TICKER_SYNC_DELAY_MS);
    setTickerStatus(`Quelle: ${market.source || 'Markt-API'} | Letztes Update: ${updatedAt} | Nächstes Update: ${formatDateTime(nextAt)}.`);
  } catch (error) {
    setTickerStatus(error.message || 'Ticker konnte nicht aktualisiert werden.');
  } finally {
    marketTickerBusy = false;
  }
}

async function loadMarketTickerHistory() {
  try {
    const { response } = await apiFetch(`/market-history?hours=${MARKET_TICKER_HISTORY_HOURS}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result?.success || !Array.isArray(result?.data?.series)) {
      return;
    }

    const incoming = result.data.series
      .map((row) => ({
        at: new Date(row.timestamp),
        valueCt: Number(row.value_ct_per_kwh)
      }))
      .filter((row) => Number.isFinite(row.at.getTime()) && Number.isFinite(row.valueCt));

    if (!incoming.length) {
      return;
    }

    marketTickerSamples = incoming
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(-MARKET_TICKER_SAMPLE_LIMIT);
  } catch {
    // History is optional; ticker can still operate with live values only.
  }
}

function addTickerSample(sample) {
  const ts = sample.at.getTime();
  const existingIndex = marketTickerSamples.findIndex((entry) => entry.at.getTime() === ts);

  if (existingIndex >= 0) {
    marketTickerSamples[existingIndex] = sample;
  } else {
    marketTickerSamples.push(sample);
  }

  marketTickerSamples.sort((a, b) => a.at.getTime() - b.at.getTime());
  if (marketTickerSamples.length > MARKET_TICKER_SAMPLE_LIMIT) {
    marketTickerSamples = marketTickerSamples.slice(-MARKET_TICKER_SAMPLE_LIMIT);
  }
}

function renderTickerTrend() {
  if (!marketTickerTrend || !marketTickerSamples.length) {
    return;
  }

  marketTickerTrend.classList.remove('trend-up', 'trend-down', 'trend-flat');

  if (marketTickerSamples.length < 2) {
    marketTickerTrend.classList.add('trend-flat');
    marketTickerTrend.textContent = 'seitwärts';
    return;
  }

  const last = marketTickerSamples[marketTickerSamples.length - 1].valueCt;
  const prev = marketTickerSamples[marketTickerSamples.length - 2].valueCt;
  const delta = last - prev;

  if (Math.abs(delta) < 0.001) {
    marketTickerTrend.classList.add('trend-flat');
    marketTickerTrend.textContent = 'seitwärts (0 ct/kWh)';
    return;
  }

  if (delta > 0) {
    marketTickerTrend.classList.add('trend-up');
    marketTickerTrend.textContent = `steigend (${formatSignedCt(delta)} ct/kWh)`;
    return;
  }

  marketTickerTrend.classList.add('trend-down');
  marketTickerTrend.textContent = `fallend (${formatSignedCt(delta)} ct/kWh)`;
}

function setTickerStatus(message) {
  if (!marketTickerStatus) return;
  marketTickerStatus.textContent = message;
}

function renderTariffTable(tariffs) {
  const tbody = document.querySelector('#tariffTable tbody');
  tbody.innerHTML = '';

  tariffs.forEach((tariff) => {
    const tr = document.createElement('tr');
    if (tariff.recommended) tr.classList.add('best');

    tr.innerHTML = `
      <td>${escapeHtml(tariff.label)}${tariff.recommended ? ' (Empfohlen)' : ''}</td>
      <td>${formatEuro(tariff.netCost_eur)}</td>
      <td>${formatEuro(tariff.energyCost_eur)}</td>
      <td>${formatEuro(tariff.networkCost_eur)}</td>
      <td>${formatEuro(tariff.feedInRevenue_eur)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderTransparency(entries) {
  const container = byId('transparencyList');
  container.innerHTML = '';

  if (!entries.length) {
    container.textContent = 'Keine Transparenzdaten vorhanden.';
    return;
  }

  entries.forEach((entry) => {
    const box = document.createElement('article');
    box.className = 'transparency-item';
    box.innerHTML = `
      <div class="transparency-top">
        <strong>${escapeHtml(entry.category)}</strong>
        <span class="status ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>
      </div>
      <p>Quelle: ${escapeHtml(entry.source)}</p>
      <p>Hinweis: ${escapeHtml(entry.note)}</p>
    `;
    container.appendChild(box);
  });
}

function renderCharts(data) {
  if (typeof Chart === 'undefined') {
    return;
  }

  const monthlyCanvas         = byId('monthlyChart');
  const balanceCanvas         = byId('balanceChart');
  if (!monthlyCanvas || !balanceCanvas) {
    return;
  }

  if (monthlyChart)         monthlyChart.destroy();
  if (balanceChart)         balanceChart.destroy();

  const monthly = data.monthly || [];

  const CHART_DEFAULTS = {
    x: { ticks: { color: '#334155' }, grid: { color: '#E4E9F0' } },
    y: { ticks: { color: '#334155' }, grid: { color: '#E4E9F0' } }
  };

  // ── 1. Monatsbilanz (PV vs. Verbrauch) ───────────────────────────────────
  monthlyChart = new Chart(monthlyCanvas, {
    type: 'line',
    data: {
      labels: monthly.map((x) => x.month),
      datasets: [
        {
          label: 'PV kWh',
          data: monthly.map((x) => x.pv_kwh),
          borderColor: '#0B8F6A',
          backgroundColor: 'rgba(11,143,106,0.12)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'Verbrauch kWh',
          data: monthly.map((x) => x.consumption_kwh),
          borderColor: '#E3223A',
          backgroundColor: 'rgba(227,34,58,0.12)',
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#334155' } }
      },
      scales: CHART_DEFAULTS
    }
  });

  // ── 2. Monatliche Energiebilanz (über/unter X-Achse) ────────────────────
  const balanceData = monthly.map((m) => +(m.pv_kwh - m.consumption_kwh).toFixed(1));
  const balanceColors = balanceData.map((v) => (v >= 0 ? '#0B8F6A' : '#E3223A'));
  const balanceBorder = balanceData.map((v) => (v >= 0 ? '#0B8F6A' : '#E3223A'));

  balanceChart = new Chart(balanceCanvas, {
    type: 'bar',
    data: {
      labels: monthly.map((x) => x.month),
      datasets: [{
        label: 'Energiebilanz (kWh)',
        data: balanceData,
        backgroundColor: balanceColors,
        borderColor: balanceBorder,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              return v >= 0
                ? ` Überschuss: +${formatNumber(v)} kWh`
                : ` Defizit: ${formatNumber(v)} kWh`;
            }
          }
        }
      },
      scales: {
        x: CHART_DEFAULTS.x,
        y: {
          ...CHART_DEFAULTS.y,
          beginAtZero: false,
          ticks: {
            color: '#334155',
            callback: (v) => `${v > 0 ? '+' : ''}${formatNumber(v)}`
          },
          grid: {
            color: (ctx) => ctx.tick.value === 0 ? '#E3223A' : '#E4E9F0',
            lineWidth: (ctx) => ctx.tick.value === 0 ? 2 : 1
          }
        }
      }
    }
  });
}

const EA_REF_HEAT_NEED_KWH_PER_M2 = 14.6;
const EA_HEAT_PUMP_COP = 3.2;

const EA_HEATING_TYPES = {
  district: {
    inputLabel: 'Fernwärmeverbrauch (automatisch aus m² berechnet)',
    hint: 'Fernwärme: Verbrauch wird aus Wohnfläche × 14,6 kWh/m² berechnet.',
    needsConsumption: false,
    needsBasePrice: true,
    variableCostPerKwh: 0.145,
    efficiency: 1.0
  },
  gas: {
    inputLabel: 'Jährlicher Gasverbrauch (kWh Heizwert)',
    hint: 'Gas: Verbrauch in kWh eingeben. Umrechnung: 1 m³ Erdgas ≈ 10 kWh Hi.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: 0.12,
    efficiency: 0.92
  },
  oil: {
    inputLabel: 'Jährlicher Ölverbrauch (kWh Heizwert)',
    hint: 'Heizöl: Verbrauch in kWh eingeben. Umrechnung: 1 Liter Heizöl ≈ 10 kWh Hi.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: 0.11,
    efficiency: 0.88
  },
  wood: {
    inputLabel: 'Jährlicher Holz-/Pelletverbrauch (kWh)',
    hint: 'Holz/Pellets: Verbrauch in kWh eingeben. Umrechnung: 1 kg Pellets ≈ 5 kWh, 1 Ster Holz ≈ 1.500 kWh.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: 0.08,
    efficiency: 0.85
  },
  heatpump: {
    inputLabel: 'Jährlicher Heizstromverbrauch Wärmepumpe (kWh)',
    hint: 'Wärmepumpe: Jährlichen Stromverbrauch für Heizung in kWh eingeben.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: null,
    efficiency: EA_HEAT_PUMP_COP
  }
};

const EA_ALTERNATIVES = [
  { key: 'district', label: 'Fernwärme', variableCostPerKwh: 0.145, basePrice: 420, efficiency: 1.0 },
  { key: 'gas', label: 'Gas', variableCostPerKwh: 0.12, basePrice: 0, efficiency: 0.92 },
  { key: 'oil', label: 'Öl', variableCostPerKwh: 0.11, basePrice: 0, efficiency: 0.88 },
  { key: 'wood', label: 'Holz/Pellets', variableCostPerKwh: 0.08, basePrice: 0, efficiency: 0.85 },
  { key: 'heatpump', label: 'Wärmepumpe', variableCostPerKwh: null, basePrice: 0, efficiency: EA_HEAT_PUMP_COP }
];

// ── Heizquellen-Karten-System ────────────────────────────────────────────────
const heatingSourcesContainer = () => byId('heatingSources');

function initEnergyAnalysisSection() {
  if (!byId('areaM2')) {
    return;
  }

  initHeatingSources();

  // Wenn WP in Großverbraucher aktiviert/deaktiviert wird → WP-Karte aktualisieren
  byId('hasHeatPump')?.addEventListener('change', () => {
    syncWpHeatingCard();
  });
}

function initHeatingSources() {
  const container = heatingSourcesContainer();
  const addBtn = byId('addHeatingSourceBtn');
  if (!container || !addBtn) return;

  addBtn.addEventListener('click', () => addHeatingSource());

  container.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.heating-source-remove-btn');
    if (!removeBtn) return;
    const card = removeBtn.closest('.heating-source');
    if (card) {
      card.remove();
      renumberHeatingSources();
    }
  });

  // Standard: eine Heizquelle (Gas) vorbelegen
  if (!container.children.length) {
    addHeatingSource({ type: 'gas' });
  }

  syncWpHeatingCard();
}

function syncWpHeatingCard() {
  const container = heatingSourcesContainer();
  if (!container) return;
  const hasHeatPump = byId('hasHeatPump')?.checked === true;
  const existing = container.querySelector('.heating-source-wp-info');

  if (hasHeatPump && !existing) {
    const info = document.createElement('div');
    info.className = 'heating-source heating-source-wp-info';
    info.style.cssText = 'border:1px dashed #0B8F6A; background:#f0faf7; padding:0.75rem 1rem; border-radius:8px; font-size:0.9rem; color:#0B8F6A;';
    info.innerHTML = `⚡ <strong>Wärmepumpe</strong> – Stromverbrauch wird automatisch aus dem Großverbraucher-Schritt übernommen und in der Tarifberechnung berücksichtigt. Hier keine weitere Eingabe nötig.`;
    container.prepend(info);
  } else if (!hasHeatPump && existing) {
    existing.remove();
  }
  renumberHeatingSources();
}

function addHeatingSource(source = {}) {
  const container = heatingSourcesContainer();
  if (!container) return;

  const type = source.type || 'gas';
  const cfg = EA_HEATING_TYPES[type] || EA_HEATING_TYPES.gas;

  const card = document.createElement('div');
  card.className = 'heating-source';
  card.innerHTML = `
    <div class="ev-vehicle-head">
      <strong class="heating-source-title">Heizquelle</strong>
      <button type="button" class="ghost heating-source-remove-btn">Entfernen</button>
    </div>
    <div class="grid three">
      <label class="field">
        <span>Heizart <button type="button" class="info-btn" data-info="heatingType">&#9432;</button></span>
        <select class="heating-source-type">
          <option value="gas">Gas</option>
          <option value="oil">Öl / Heizöl</option>
          <option value="wood">Holz / Pellets</option>
          <option value="district">Fernwärme</option>
        </select>
      </label>
      <label class="field heating-source-consumption-field">
        <span class="heating-source-consumption-label">${cfg.inputLabel} <button type="button" class="info-btn" data-info="heatingConsumption">&#9432;</button></span>
        <input class="heating-source-consumption" type="number" min="0" step="1" value="${source.consumption || ''}">
        <small class="hint heating-source-hint">${cfg.hint}</small>
      </label>
      <label class="field heating-source-baseprice-field hidden">
        <span>Fernwärme Grundpreis (EUR/Jahr) <button type="button" class="info-btn" data-info="districtBasePrice">&#9432;</button></span>
        <input class="heating-source-baseprice" type="number" min="0" step="0.01" value="${source.basePrice || 420}">
      </label>
    </div>
  `;

  card.querySelector('.heating-source-type').value = type;
  syncHeatingSourceCard(card);

  card.querySelector('.heating-source-type').addEventListener('change', () => syncHeatingSourceCard(card));

  container.appendChild(card);
  renumberHeatingSources();
}

function syncHeatingSourceCard(card) {
  const type = card.querySelector('.heating-source-type')?.value || 'gas';
  const cfg = EA_HEATING_TYPES[type] || EA_HEATING_TYPES.gas;

  const consumptionField = card.querySelector('.heating-source-consumption-field');
  const basePriceField = card.querySelector('.heating-source-baseprice-field');
  const label = card.querySelector('.heating-source-consumption-label');
  const hint = card.querySelector('.heating-source-hint');

  consumptionField?.classList.toggle('hidden', !cfg.needsConsumption);
  basePriceField?.classList.toggle('hidden', !cfg.needsBasePrice);
  if (label) label.innerHTML = `${cfg.inputLabel} <button type="button" class="info-btn" data-info="heatingConsumption">&#9432;</button>`;
  if (hint) hint.textContent = cfg.hint;
}

function renumberHeatingSources() {
  const container = heatingSourcesContainer();
  if (!container) return;
  const regularCards = Array.from(container.querySelectorAll('.heating-source:not(.heating-source-wp-info)'));
  regularCards.forEach((card, i) => {
    const title = card.querySelector('.heating-source-title');
    if (title) title.textContent = `Heizquelle ${i + 1}`;
    const removeBtn = card.querySelector('.heating-source-remove-btn');
    if (removeBtn) removeBtn.disabled = regularCards.length <= 1;
  });
}

function collectHeatingSources() {
  const container = heatingSourcesContainer();
  if (!container) return [];
  return Array.from(container.querySelectorAll('.heating-source:not(.heating-source-wp-info)')).map(card => ({
    type: card.querySelector('.heating-source-type')?.value || 'gas',
    consumption: Number(card.querySelector('.heating-source-consumption')?.value) || 0,
    basePrice: Number(card.querySelector('.heating-source-baseprice')?.value) || 420
  }));
}

function renderEnergyAnalysis() {
  const areaM2 = eaNum('areaM2', 120);
  const annualPowerCost = eaNum('annualPowerCost', 0);
  const totalConsumptionFromMain = Number(latestData?.summary?.totalConsumption_kwh);
  const annualPowerUse = Math.max(
    Number.isFinite(totalConsumptionFromMain) && totalConsumptionFromMain > 0
      ? totalConsumptionFromMain
      : eaNum('annualPowerUse', 3500),
    1
  );

  const avgPowerPrice = annualPowerCost > 0 ? annualPowerCost / annualPowerUse : 0.32; // Fallback 32 ct/kWh
  const hasHeatPump = byId('hasHeatPump')?.checked === true;

  // Heizquellen aus Karten einsammeln
  const sources = collectHeatingSources();

  // WP aus Großverbraucher als virtuelle Quelle hinzufügen (falls aktiv)
  if (hasHeatPump) {
    const wpConsumption = eaNum('heatPumpConsumption', 0);
    if (wpConsumption > 0) {
      sources.push({ type: 'heatpump', consumption: wpConsumption, basePrice: 0 });
    }
  }

  // Heizkosten über alle Quellen summieren
  let totalHeatNeedKwh = 0;
  let totalHeatingCostAbs = 0;
  let primaryHeatingType = sources.length > 0 ? sources[0].type : 'district';

  for (const src of sources) {
    const heatConsumptionKwh = src.type === 'district'
      ? areaM2 * EA_REF_HEAT_NEED_KWH_PER_M2
      : src.consumption;
    const heatNeedKwh = toEnergyHeatNeedKwh(src.type, heatConsumptionKwh);
    const cost = calcEnergyHeatingCost({
      heatingType: src.type,
      heatConsumptionKwh,
      avgPowerPrice,
      districtBasePrice: src.basePrice || 420
    });
    totalHeatNeedKwh += heatNeedKwh;
    totalHeatingCostAbs += cost;
  }

  // Fallback: keine Quellen erfasst
  if (!sources.length) {
    totalHeatNeedKwh = areaM2 * EA_REF_HEAT_NEED_KWH_PER_M2;
    totalHeatingCostAbs = totalHeatNeedKwh * EA_HEATING_TYPES.district.variableCostPerKwh + 420;
  }

  const totalHeatConsumptionKwh = sources.reduce((sum, src) =>
    sum + (src.type === 'district' ? areaM2 * EA_REF_HEAT_NEED_KWH_PER_M2 : src.consumption), 0
  ) || (areaM2 * EA_REF_HEAT_NEED_KWH_PER_M2);

  const heatCostPerKwh = eaSafeDiv(totalHeatingCostAbs, Math.max(totalHeatConsumptionKwh, 1));
  const heatCostPerM2 = eaSafeDiv(totalHeatingCostAbs, Math.max(areaM2, 1));

  // Stromkosten: WP-Anteil aus Gesamtkosten herausrechnen wenn bekannt
  const wpConsumption = hasHeatPump ? eaNum('heatPumpConsumption', 0) : 0;
  const householdPowerCost = annualPowerCost > 0
    ? Math.max(annualPowerCost - wpConsumption * avgPowerPrice, 0)
    : (annualPowerUse - wpConsumption) * avgPowerPrice;
  const powerCostPerM2 = eaSafeDiv(householdPowerCost, Math.max(areaM2, 1));

  const heatPerM2 = eaSafeDiv(totalHeatNeedKwh, Math.max(areaM2, 1));
  const quality = classifyEnergyHeatNeed(heatPerM2);

  setText('resPowerUse', `${eaFmtNum(annualPowerUse)} kWh`);
  setText('resPowerPrice', `${(avgPowerPrice * 100).toFixed(1)} ct/kWh`);
  setText('resPowerPerM2', `${eaFmtMoney(powerCostPerM2)} / m²`);
  setText('resHeatCost', eaFmtMoney(totalHeatingCostAbs));
  setText('resHeatPerM2', `${eaFmtNum(heatPerM2)} kWh/m²`);

  const resEfficiency = byId('resEfficiency');
  if (resEfficiency) {
    resEfficiency.innerHTML = `${quality.label} <span class="quality-badge ${quality.className}">${quality.grade}</span>`;
  }
  setText('resHeatCostPerKwh', `${eaFmtMoney(heatCostPerKwh)} / kWh`);
  setText('resHeatCostPerM2', `${eaFmtMoney(heatCostPerM2)} / m²`);

  const districtBaseForTable = sources.find(s => s.type === 'district')?.basePrice || 420;
  renderEnergyComparisonTable({
    heatNeedKwh: totalHeatNeedKwh,
    avgPowerPrice,
    districtBasePrice: districtBaseForTable,
    currentHeatingType: primaryHeatingType,
    currentHeatingCost: totalHeatingCostAbs
  });
}

function syncEnergyInputVisibility(_cfg, _hasHeatPump = false) {
  // Wird nicht mehr für das Einzel-Formular genutzt – ersetzt durch Karten-System
}

function calcEnergyHeatingCost({ heatingType, heatConsumptionKwh, avgPowerPrice, districtBasePrice }) {
  if (heatingType === 'heatpump') {
    return heatConsumptionKwh * avgPowerPrice;
  }

  if (heatingType === 'district') {
    return heatConsumptionKwh * EA_HEATING_TYPES.district.variableCostPerKwh + districtBasePrice;
  }

  const cfg = EA_HEATING_TYPES[heatingType] || EA_HEATING_TYPES.district;
  return heatConsumptionKwh * cfg.variableCostPerKwh;
}

function toEnergyHeatNeedKwh(heatingType, annualConsumptionKwh) {
  const cfg = EA_HEATING_TYPES[heatingType] || EA_HEATING_TYPES.district;
  if (!annualConsumptionKwh || annualConsumptionKwh <= 0) return 0;
  return annualConsumptionKwh * cfg.efficiency;
}

function classifyEnergyHeatNeed(heatNeedPerM2) {
  if (heatNeedPerM2 <= 40) return { grade: 'A', label: 'sehr gut', className: 'verygood' };
  if (heatNeedPerM2 <= 70) return { grade: 'B', label: 'gut', className: 'good' };
  if (heatNeedPerM2 <= 110) return { grade: 'C', label: 'mittel', className: 'medium' };
  if (heatNeedPerM2 <= 160) return { grade: 'D', label: 'schlecht', className: 'bad' };
  return { grade: 'E', label: 'sehr schlecht', className: 'verybad' };
}

function renderEnergyComparisonTable({
  heatNeedKwh,
  avgPowerPrice,
  districtBasePrice,
  currentHeatingType,
  currentHeatingCost
}) {
  const tbody = document.querySelector('#heatingCompareTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  EA_ALTERNATIVES.forEach((alt) => {
    const neededConsumption = alt.efficiency > 0 ? heatNeedKwh / alt.efficiency : 0;
    const annualCost = estimateEnergyAnnualCost({
      alternative: alt,
      neededConsumption,
      avgPowerPrice,
      districtBasePrice
    });

    const delta = annualCost - currentHeatingCost;
    const tr = document.createElement('tr');
    if (alt.key === currentHeatingType) tr.classList.add('best');

    tr.innerHTML = `
      <td>${escapeHtml(alt.label)}${alt.key === currentHeatingType ? ' (aktuell)' : ''}</td>
      <td>${eaFmtNum(neededConsumption)} kWh</td>
      <td>${eaFmtMoney(annualCost)}</td>
      <td>${eaFmtSignedMoney(delta)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function estimateEnergyAnnualCost({ alternative, neededConsumption, avgPowerPrice, districtBasePrice }) {
  if (alternative.key === 'heatpump') {
    return neededConsumption * avgPowerPrice;
  }

  if (alternative.key === 'district') {
    return neededConsumption * alternative.variableCostPerKwh + districtBasePrice;
  }

  return neededConsumption * alternative.variableCostPerKwh + (alternative.basePrice || 0);
}

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value;
}

function eaNum(id, fallback = 0) {
  const raw = byId(id)?.value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function eaSafeDiv(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

function eaFmtNum(value) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value || 0);
}

function eaFmtMoney(value) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2
  }).format(value || 0);
}

function eaFmtSignedMoney(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${eaFmtMoney(value)}`;
}

function showError(message) {
  clearSuccess();
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

function showSuccess(message) {
  successBox.textContent = message;
  successBox.classList.remove('hidden');
}

function clearSuccess() {
  successBox.textContent = '';
  successBox.classList.add('hidden');
}

function buildSuccessMessage(data) {
  const summary = data.summary || {};
  const visibleTariffs = getVisibleTariffsForSelectedModule(data.tariffs || []);
  const best = pickBestTariff(visibleTariffs);
  const recommendedTariff = best?.label || summary.recommendedTariff || 'kein Tarif';
  const recommendedModule = formatSelectedModuleLabel(determineModuleDecision().module);
  return `Berechnung erfolgreich. Empfohlen: ${recommendedTariff} mit ${recommendedModule}. Jahresverbrauch: ${formatNumber(summary.totalConsumption_kwh)} kWh.`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value || 0);
}

function formatEuro(value) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2
  }).format(value || 0);
}

function formatTime(value) {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value);
}

function formatCtPerKwh(value) {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(value || 0);
}

function formatSignedCt(value) {
  const rounded = Number(value.toFixed(3));
  return rounded > 0 ? `+${formatCtPerKwh(rounded)}` : `${formatCtPerKwh(rounded)}`;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
