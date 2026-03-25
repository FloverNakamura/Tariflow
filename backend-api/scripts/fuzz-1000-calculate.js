/*
  Fuzz and stress test for /api/calculate
  - Sends 1000 requests with plausible + absurd values
  - Summarizes status codes, crashes, schema validity, and suspicious numeric outputs
*/

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function maybe(value, probability = 0.5) {
  return Math.random() < probability ? value : undefined;
}

function randomPlz() {
  const candidates = [
    '80331',
    '10115',
    '20095',
    '50667',
    '70173',
    '01067',
    '00000',
    '99999',
    '',
    'abcde',
    '12',
    '123456',
    null
  ];
  return pick(candidates);
}

function randomNumberish(min, max) {
  const weird = [null, '', 'NaN', '1000', '-5', 0, -1, 1e9, -1e6];
  if (Math.random() < 0.25) return pick(weird);
  return Number((Math.random() * (max - min) + min).toFixed(2));
}

function makeCase(i) {
  const absurd = i >= 700; // last 300 focused on absurd values

  const personsValues = absurd
    ? [-5, 0, 1, 2, 3, 4, 5, 99, null, '2']
    : [1, 2, 3, 4];

  const buildingValues = absurd
    ? ['EFH', 'MFH', 'Gewerbe', 'Villa', '', null, 123]
    : ['EFH', 'MFH', 'Gewerbe'];

  const moduleValues = absurd
    ? ['none', 'modul1', 'modul2', 'modul3', 'modulX', '', null, 7]
    : ['none', 'modul1', 'modul2', 'modul3'];

  const hasPv = absurd ? pick([true, false, 'true', null, 1]) : pick([true, false]);
  const hasStorage = absurd ? pick([true, false, 'yes', null, 0]) : pick([true, false]);
  const hasHP = absurd ? pick([true, false, 'on', null]) : pick([true, false]);
  const hasEV = absurd ? pick([true, false, 'ev', null]) : pick([true, false]);

  const payload = {
    household: {
      persons: pick(personsValues),
      plz: randomPlz(),
      buildingType: pick(buildingValues),
      annualConsumption_kwh: absurd ? randomNumberish(-5000, 150000) : randomNumberish(1200, 10000)
    },
    pv: {
      hasPv,
      peakpower_kwp: absurd ? randomNumberish(-50, 5000) : randomNumberish(2, 25),
      angle_deg: absurd ? randomNumberish(-200, 200) : randomNumberish(0, 70),
      aspect_deg: absurd ? randomNumberish(-720, 720) : randomNumberish(-120, 120),
      loss_pct: absurd ? randomNumberish(-50, 200) : randomNumberish(5, 25)
    },
    storage: {
      hasStorage,
      capacity_kwh: absurd ? randomNumberish(-100, 1000) : randomNumberish(3, 30),
      maxPower_kw: absurd ? randomNumberish(-100, 500) : randomNumberish(2, 22),
      efficiency: absurd ? randomNumberish(-1, 2) : randomNumberish(0.7, 0.98),
      useDynamicOptimization: absurd ? pick([true, false, 'auto', null]) : pick([true, false])
    },
    heatPump: {
      hasHeatPump: hasHP,
      annualConsumption_kwh: absurd ? randomNumberish(-10000, 80000) : randomNumberish(0, 8000),
      cop: absurd ? randomNumberish(-5, 20) : randomNumberish(2, 5),
      use14aModule: absurd ? pick([true, false, 'yes', null]) : pick([true, false])
    },
    emobility: {
      hasEV,
      annualKm: absurd ? randomNumberish(-50000, 300000) : randomNumberish(0, 30000),
      consumption_kwh_per_100km: absurd ? randomNumberish(-20, 120) : randomNumberish(12, 30),
      chargingPower_kw: absurd ? randomNumberish(-50, 350) : randomNumberish(3, 22),
      preferNightCharging: absurd ? pick([true, false, 'night', null]) : pick([true, false]),
      useBidirectional: absurd ? pick([true, false, 'v2g', null]) : pick([true, false])
    },
    tariff: {
      compareStaticTariff: absurd ? pick([true, false, 'yes', null]) : true,
      compareDynamicTariff: absurd ? pick([true, false, 'yes', null]) : true,
      module14a: pick(moduleValues)
    }
  };

  // Force some known-invalid shapes
  if (absurd && Math.random() < 0.08) delete payload.household;
  if (absurd && Math.random() < 0.08) payload.household = { persons: pick(personsValues) };
  if (absurd && Math.random() < 0.08) payload.tariff = maybe({}, 1);

  return payload;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkPlausibility(data) {
  const flags = [];
  if (!data || typeof data !== 'object') {
    flags.push('missing_data');
    return flags;
  }

  const s = data.summary;
  if (!s || typeof s !== 'object') {
    flags.push('missing_summary');
    return flags;
  }

  const nums = [
    s.pvYield_kwh,
    s.totalConsumption_kwh,
    s.selfConsumption_kwh,
    s.gridFeed_kwh,
    s.gridDraw_kwh,
    s.annualSavingVsStatic_eur
  ];

  if (nums.some((n) => !isFiniteNumber(n))) flags.push('non_numeric_summary');
  if (nums.slice(0, 5).some((n) => isFiniteNumber(n) && n < -1e-6)) flags.push('negative_energy');

  if (isFiniteNumber(s.totalConsumption_kwh) && s.totalConsumption_kwh > 1_000_000) flags.push('extreme_consumption');
  if (isFiniteNumber(s.pvYield_kwh) && s.pvYield_kwh > 1_000_000) flags.push('extreme_pv');

  if (Array.isArray(data.tariffs)) {
    for (const t of data.tariffs) {
      if (!isFiniteNumber(t.netCost_eur)) flags.push('tariff_non_numeric_cost');
      if (isFiniteNumber(t.selfConsumptionRate_pct) && (t.selfConsumptionRate_pct < 0 || t.selfConsumptionRate_pct > 100)) {
        flags.push('tariff_self_rate_out_of_range');
      }
      if (isFiniteNumber(t.autarkyRate_pct) && (t.autarkyRate_pct < 0 || t.autarkyRate_pct > 100)) {
        flags.push('tariff_autarky_out_of_range');
      }
    }
  } else {
    flags.push('missing_tariffs_array');
  }

  return flags;
}

async function run() {
  const total = 1000;
  const report = {
    total,
    ok2xx: 0,
    badRequest4xx: 0,
    server5xx: 0,
    networkOrParseError: 0,
    successTrue: 0,
    successFalse: 0,
    plausibilityFlags: {},
    sampleErrors: [],
    sampleSuspicious: []
  };

  for (let i = 0; i < total; i += 1) {
    const payload = makeCase(i);

    let response;
    let json;

    try {
      response = await fetch('http://localhost:3001/api/calculate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await response.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch (parseError) {
        report.networkOrParseError += 1;
        if (report.sampleErrors.length < 10) {
          report.sampleErrors.push({ case: i + 1, type: 'json_parse_error', status: response.status, bodyPreview: text.slice(0, 180) });
        }
        continue;
      }
    } catch (error) {
      report.networkOrParseError += 1;
      if (report.sampleErrors.length < 10) {
        report.sampleErrors.push({ case: i + 1, type: 'fetch_error', message: String(error) });
      }
      continue;
    }

    if (response.status >= 200 && response.status < 300) report.ok2xx += 1;
    else if (response.status >= 400 && response.status < 500) report.badRequest4xx += 1;
    else if (response.status >= 500) report.server5xx += 1;

    if (json && json.success === true) {
      report.successTrue += 1;
      const flags = checkPlausibility(json.data);
      if (flags.length > 0) {
        for (const f of flags) report.plausibilityFlags[f] = (report.plausibilityFlags[f] || 0) + 1;
        if (report.sampleSuspicious.length < 10) {
          report.sampleSuspicious.push({
            case: i + 1,
            flags,
            input: {
              persons: payload?.household?.persons,
              plz: payload?.household?.plz,
              hasPv: payload?.pv?.hasPv,
              peakpower_kwp: payload?.pv?.peakpower_kwp,
              hasStorage: payload?.storage?.hasStorage,
              hasEV: payload?.emobility?.hasEV,
              module14a: payload?.tariff?.module14a
            },
            summary: json?.data?.summary || null
          });
        }
      }
    } else {
      report.successFalse += 1;
      if (report.sampleErrors.length < 10) {
        report.sampleErrors.push({
          case: i + 1,
          type: 'success_false_or_missing',
          status: response.status,
          error: json?.error || null
        });
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error('Fatal fuzz error:', err);
  process.exit(1);
});
