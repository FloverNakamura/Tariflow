const byId = (id) => document.getElementById(id);

const REF_HEAT_NEED_KWH_PER_M2 = 14.6;
const HEAT_PUMP_COP = 3.2;

const HEATING_TYPES = {
  district: {
    label: 'Fernwärme',
    unit: 'kWh',
    inputLabel: 'Fernwärmeverbrauch (automatisch aus m² berechnet)',
    hint: 'Fernwärme: Verbrauch wird aus Wohnfläche x 14,6 kWh/m² berechnet. Grundpreis separat eingeben.',
    needsConsumption: false,
    needsBasePrice: true,
    variableCostPerKwh: 0.145,
    efficiency: 1.0
  },
  gas: {
    label: 'Gas',
    unit: 'kWh',
    inputLabel: 'Jährlicher Gasverbrauch (kWh)',
    hint: 'Gas: Bitte den jährlichen Gasverbrauch in kWh eingeben.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: 0.12,
    efficiency: 0.92
  },
  oil: {
    label: 'Öl',
    unit: 'kWh',
    inputLabel: 'Jährlicher Ölverbrauch (kWh äq.)',
    hint: 'Öl: Bitte den jährlichen Ölverbrauch in kWh-äquivalent eingeben.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: 0.11,
    efficiency: 0.88
  },
  wood: {
    label: 'Holz/Pellets',
    unit: 'kWh',
    inputLabel: 'Jährlicher Holz-/Pelletverbrauch (kWh)',
    hint: 'Holz/Pellets: Bitte den jährlichen Energieverbrauch in kWh eingeben.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: 0.08,
    efficiency: 0.85
  },
  heatpump: {
    label: 'Wärmepumpe',
    unit: 'kWh',
    inputLabel: 'Jährlicher Heizstromverbrauch Wärmepumpe (kWh)',
    hint: 'Wärmepumpe: Bitte den jährlichen Stromverbrauch für Heizung in kWh eingeben.',
    needsConsumption: true,
    needsBasePrice: false,
    variableCostPerKwh: null,
    efficiency: HEAT_PUMP_COP
  }
};

const ALTERNATIVES = [
  { key: 'district', label: 'Fernwärme', variableCostPerKwh: 0.145, basePrice: 420, efficiency: 1.0 },
  { key: 'gas', label: 'Gas', variableCostPerKwh: 0.12, basePrice: 0, efficiency: 0.92 },
  { key: 'oil', label: 'Öl', variableCostPerKwh: 0.11, basePrice: 0, efficiency: 0.88 },
  { key: 'wood', label: 'Holz/Pellets', variableCostPerKwh: 0.08, basePrice: 0, efficiency: 0.85 },
  { key: 'heatpump', label: 'Wärmepumpe', variableCostPerKwh: null, basePrice: 0, efficiency: HEAT_PUMP_COP }
];

const INFO_TEXTS = {
  inputsOverview: {
    title: 'Eingaben',
    html: `<p>Hier gibst du die Basisdaten für die Energieanalyse ein: Wohnfläche, Stromdaten und die aktuelle Heizart.</p>
           <p>Alle Kennzahlen werden sofort neu berechnet. Die Seite dient als schnelle überschlägige Vergleichsrechnung und nicht als förmliches Gutachten.</p>`
  },
  areaM2: {
    title: 'Wohnfläche',
    html: `<p>Die Wohnfläche in Quadratmetern ist die Bezugsgröße für mehrere Kennzahlen.</p>
           <div class="formula">Kosten pro m² = Jahreskosten / Wohnfläche</div>
           <p>Außerdem wird der Heizenergiebedarf pro m² daraus abgeleitet und gegen Referenzbereiche eingeordnet.</p>`
  },
  powerTariff: {
    title: 'Aktueller Stromtarif',
    html: `<p>Der aktuell genutzte Tarif dient hier vor allem zur Einordnung des Haushalts.</p>
           <p>Die eigentliche Berechnung des durchschnittlichen Strompreises erfolgt aus deinen eingegebenen Jahreskosten und dem Jahresverbrauch.</p>`
  },
  annualPowerCost: {
    title: 'Jährliche Stromkosten',
    html: `<p>Das ist dein gesamter jährlicher Stromkostenbetrag in Euro.</p>
           <div class="formula">Ø Strompreis = jährliche Stromkosten / jährlicher Stromverbrauch</div>
           <p>Bei einer Wärmepumpe wird daraus auch der angenäherte Heizstrompreis abgeleitet.</p>`
  },
  annualPowerUse: {
    title: 'Jährlicher Stromverbrauch',
    html: `<p>Der gesamte jährliche Stromverbrauch des Haushalts in kWh.</p>
           <p>Zusammen mit den jährlichen Stromkosten ergibt sich daraus der durchschnittliche Preis pro kWh Strom.</p>`
  },
  heatingType: {
    title: 'Heizart',
    html: `<p>Hier legst du fest, mit welchem Energieträger das Gebäude aktuell beheizt wird.</p>
           <p>Je nach Auswahl ändert sich die Kostenlogik:</p>
           <ul>
             <li>Fernwärme: Arbeitspreis plus Grundpreis</li>
             <li>Gas, Öl, Holz: Verbrauch × hinterlegter Referenzpreis</li>
             <li>Wärmepumpe: Heizstromverbrauch × aktueller Strompreis</li>
           </ul>`
  },
  heatingConsumption: {
    title: 'Jährlicher Heizverbrauch',
    html: `<p>Hier wird der gemessene oder geschätzte Jahresverbrauch des gewählten Heizsystems eingetragen.</p>
           <p>Bei Wärmepumpen ist das der elektrische Heizstromverbrauch. Bei Gas, Öl und Holz wird daraus über Wirkungsgrade ein nutzbarer Wärmebedarf abgeleitet.</p>`
  },
  districtBasePrice: {
    title: 'Fernwärme Grundpreis',
    html: `<p>Der jährliche Grundpreis der Fernwärme wird zusätzlich zum verbrauchsabhängigen Arbeitspreis angesetzt.</p>
           <div class="formula">Fernwärmekosten = Verbrauch × Preis pro kWh + Grundpreis</div>`
  },
  resultsOverview: {
    title: 'Ergebnisse',
    html: `<p>Dieser Bereich zeigt die wichtigsten Kennzahlen zu Strom- und Heizkosten sowie die Effizienzbewertung deines Gebäudes.</p>
           <p>Die Werte helfen dir dabei, deinen aktuellen Zustand zu verstehen und Alternativen direkt zu vergleichen.</p>`
  },
  resPowerUse: {
    title: 'Gesamtstromverbrauch/Jahr',
    html: `<p>Zeigt den eingegebenen jährlichen Stromverbrauch des Haushalts.</p>
           <p>Dieser Wert wird direkt aus deinen Eingaben übernommen und nicht zusätzlich modelliert.</p>`
  },
  resPowerPrice: {
    title: 'Ø Strompreis',
    html: `<p>Der durchschnittliche Strompreis ergibt sich aus deinen Gesamtkosten und dem Jahresverbrauch.</p>
           <div class="formula">Ø Strompreis = Stromkosten / Stromverbrauch</div>`
  },
  resPowerPerM2: {
    title: 'Ø Stromkosten pro m²',
    html: `<p>Die Stromkosten werden auf die Wohnfläche umgelegt.</p>
           <p>Bei einer Wärmepumpe wird der Heizstromanteil aus den Haushaltsstromkosten herausgerechnet, damit die Wohnflächenkennzahl realistischer bleibt.</p>`
  },
  resHeatCost: {
    title: 'Heizkosten/Jahr',
    html: `<p>Die jährlichen Heizkosten hängen von der ausgewählten Heizart ab.</p>
           <ul>
             <li>Fernwärme: Verbrauchskosten plus Grundpreis</li>
             <li>Gas/Öl/Holz: Verbrauch × Referenzpreis</li>
             <li>Wärmepumpe: Heizstromverbrauch × Ø Strompreis</li>
           </ul>`
  },
  resHeatPerM2: {
    title: 'Heizverbrauch pro m²',
    html: `<p>Der auf die Wohnfläche normierte Heizenergiebedarf.</p>
           <div class="formula">Heizverbrauch pro m² = jährlicher Wärmebedarf / Wohnfläche</div>
           <p>Dieser Wert ist Grundlage für die Effizienzbewertung.</p>`
  },
  resEfficiency: {
    title: 'Effizienzbewertung',
    html: `<p>Die Effizienzbewertung ordnet deinen normierten Heizbedarf in Klassen A bis E ein.</p>
           <ul>
             <li>A: sehr gut</li>
             <li>B: gut</li>
             <li>C: mittel</li>
             <li>D: schlecht</li>
             <li>E: sehr schlecht</li>
           </ul>
           <p>Je niedriger der Wärmebedarf pro m², desto besser die Bewertung.</p>`
  },
  resHeatCostPerKwh: {
    title: 'Heizkosten pro kWh',
    html: `<p>Zeigt, wie teuer eine bezogene oder erzeugte Kilowattstunde Wärme im Durchschnitt ist.</p>
           <div class="formula">Heizkosten pro kWh = jährliche Heizkosten / Heizverbrauch</div>`
  },
  resHeatCostPerM2: {
    title: 'Heizkosten pro m²',
    html: `<p>Die jährlichen Heizkosten umgelegt auf die Wohnfläche.</p>
           <div class="formula">Heizkosten pro m² = jährliche Heizkosten / Wohnfläche</div>`
  },
  heatingCompareTable: {
    title: 'Vergleich alternativer Heizsysteme',
    html: `<p>Hier wird derselbe angenäherte Wärmebedarf auf alternative Heizsysteme umgerechnet.</p>
           <p>Dadurch siehst du, wie sich Kosten bei einem Wechsel des Energieträgers verändern könnten.</p>
           <ul>
             <li>Geschätzter Verbrauch: benötigte Energiemenge beim jeweiligen System</li>
             <li>Geschätzte Jahreskosten: Verbrauch × Referenzpreis bzw. Strompreis</li>
             <li>Differenz: Abweichung zur aktuell ausgewählten Heizart</li>
           </ul>`
  }
};

const infoModal = byId('infoModal');
const infoModalTitle = byId('infoModalTitle');
const infoModalBody = byId('infoModalBody');
const infoModalClose = byId('infoModalClose');

init();

function init() {
  const ids = [
    'areaM2', 'powerTariff', 'annualPowerCost', 'annualPowerUse',
    'heatingType', 'heatingConsumption', 'districtBasePrice'
  ];

  ids.forEach((id) => {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('input', renderAll);
    el.addEventListener('change', renderAll);
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.info-btn');
    if (!button) return;
    event.stopPropagation();
    openInfoModal(button.dataset.info);
  });

  infoModalClose?.addEventListener('click', closeInfoModal);
  infoModal?.addEventListener('click', (event) => {
    if (event.target === infoModal) closeInfoModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && infoModal && !infoModal.classList.contains('hidden')) {
      closeInfoModal();
    }
  });

  renderAll();
}

function openInfoModal(key) {
  const entry = INFO_TEXTS[key];
  if (!entry || !infoModal || !infoModalTitle || !infoModalBody) return;
  infoModalTitle.textContent = entry.title;
  infoModalBody.innerHTML = entry.html;
  infoModal.classList.remove('hidden');
}

function closeInfoModal() {
  if (!infoModal) return;
  infoModal.classList.add('hidden');
}

function renderAll() {
  const areaM2 = num('areaM2', 210);
  const annualPowerCost = num('annualPowerCost', 5800);
  const annualPowerUse = Math.max(num('annualPowerUse', 20000), 1);
  const heatingType = byId('heatingType').value;
  const heatingCfg = HEATING_TYPES[heatingType] || HEATING_TYPES.district;

  syncInputVisibility(heatingCfg);

  const avgPowerPrice = annualPowerCost / annualPowerUse;

  const districtBasePrice = num('districtBasePrice', 420);
  const typedHeatingConsumption = num('heatingConsumption', 0);

  const heatConsumptionKwh = heatingType === 'district'
    ? areaM2 * REF_HEAT_NEED_KWH_PER_M2
    : typedHeatingConsumption;

  const heatNeedKwh = toHeatNeedKwh(heatingType, heatConsumptionKwh);

  const heatingCostAbs = calcHeatingCost({
    heatingType,
    heatConsumptionKwh,
    avgPowerPrice,
    districtBasePrice
  });

  const heatCostPerKwh = safeDiv(heatingCostAbs, Math.max(heatConsumptionKwh, 1));
  const heatCostPerM2 = safeDiv(heatingCostAbs, Math.max(areaM2, 1));

  const householdPowerCost = heatingType === 'heatpump'
    ? Math.max((annualPowerUse - heatConsumptionKwh) * avgPowerPrice, 0)
    : annualPowerCost;
  const powerCostPerM2 = safeDiv(householdPowerCost, Math.max(areaM2, 1));

  const heatPerM2 = safeDiv(heatNeedKwh, Math.max(areaM2, 1));
  const quality = classifyHeatNeed(heatPerM2);

  byId('resPowerUse').textContent = `${fmtNum(annualPowerUse)} kWh`;
  byId('resPowerPrice').textContent = `${fmtMoney(avgPowerPrice)} / kWh`;
  byId('resPowerPerM2').textContent = `${fmtMoney(powerCostPerM2)} / m²`;
  byId('resHeatCost').textContent = fmtMoney(heatingCostAbs);

  byId('resHeatPerM2').textContent = `${fmtNum(heatPerM2)} kWh/m²`;
  byId('resEfficiency').innerHTML = `${quality.label} <span class="quality-badge ${quality.className}">${quality.grade}</span>`;
  byId('resHeatCostPerKwh').textContent = `${fmtMoney(heatCostPerKwh)} / kWh`;
  byId('resHeatCostPerM2').textContent = `${fmtMoney(heatCostPerM2)} / m²`;

  renderComparisonTable({
    heatNeedKwh,
    avgPowerPrice,
    districtBasePrice,
    currentHeatingType: heatingType,
    currentHeatingCost: heatingCostAbs
  });
}

function syncInputVisibility(cfg) {
  const hint = byId('heatingHint');
  const consumptionField = byId('consumptionField');
  const districtBaseField = byId('districtBaseField');
  const label = byId('heatingConsumptionLabel');

  hint.textContent = cfg.hint;
  label.textContent = cfg.inputLabel;

  consumptionField.classList.toggle('hidden', !cfg.needsConsumption);
  districtBaseField.classList.toggle('hidden', !cfg.needsBasePrice);
}

function calcHeatingCost({ heatingType, heatConsumptionKwh, avgPowerPrice, districtBasePrice }) {
  if (heatingType === 'heatpump') {
    return heatConsumptionKwh * avgPowerPrice;
  }

  if (heatingType === 'district') {
    return heatConsumptionKwh * HEATING_TYPES.district.variableCostPerKwh + districtBasePrice;
  }

  const cfg = HEATING_TYPES[heatingType];
  return heatConsumptionKwh * cfg.variableCostPerKwh;
}

function toHeatNeedKwh(heatingType, enteredConsumptionKwh) {
  if (heatingType === 'heatpump') {
    return enteredConsumptionKwh * HEAT_PUMP_COP;
  }

  const eff = HEATING_TYPES[heatingType]?.efficiency || 1;
  return enteredConsumptionKwh * eff;
}

function renderComparisonTable({ heatNeedKwh, avgPowerPrice, districtBasePrice, currentHeatingType, currentHeatingCost }) {
  const tbody = document.querySelector('#heatingCompareTable tbody');
  tbody.innerHTML = '';

  ALTERNATIVES.forEach((alt) => {
    const requiredInputKwh = alt.key === 'heatpump'
      ? safeDiv(heatNeedKwh, alt.efficiency)
      : safeDiv(heatNeedKwh, Math.max(alt.efficiency, 0.01));

    let annualCost;
    if (alt.key === 'heatpump') {
      annualCost = requiredInputKwh * avgPowerPrice;
    } else if (alt.key === 'district') {
      annualCost = requiredInputKwh * alt.variableCostPerKwh + districtBasePrice;
    } else {
      annualCost = requiredInputKwh * alt.variableCostPerKwh + alt.basePrice;
    }

    const delta = annualCost - currentHeatingCost;
    const deltaClass = delta <= 0 ? 'good' : 'bad';
    const currentMark = alt.key === currentHeatingType ? ' (aktuell)' : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${alt.label}${currentMark}</td>
      <td>${fmtNum(requiredInputKwh)} kWh</td>
      <td>${fmtMoney(annualCost)}</td>
      <td class="${deltaClass}">${delta <= 0 ? '-' : '+'}${fmtMoney(Math.abs(delta))}</td>
    `;
    tbody.appendChild(tr);
  });
}

function classifyHeatNeed(kwhPerM2) {
  if (kwhPerM2 > 220) return { label: 'Sehr schlechter Referenzbereich', grade: 'E', className: 'verybad' };
  if (kwhPerM2 > 170) return { label: 'Schlechter Referenzbereich', grade: 'D', className: 'bad' };
  if (kwhPerM2 > 120) return { label: 'Mittlerer Referenzbereich', grade: 'C', className: 'medium' };
  if (kwhPerM2 > 80) return { label: 'Guter Referenzbereich', grade: 'B', className: 'good' };
  return { label: 'Sehr guter Referenzbereich', grade: 'A', className: 'verygood' };
}

function num(id, fallback = 0) {
  const val = Number(byId(id)?.value);
  return Number.isFinite(val) ? val : fallback;
}

function safeDiv(a, b) {
  return b === 0 ? 0 : a / b;
}

function fmtNum(value) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value || 0);
}

function fmtMoney(value) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}
