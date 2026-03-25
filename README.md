# Tariflow

Tariflow ist ein Web-Tool zur Tarif- und Verbrauchsberechnung mit Fokus auf:

- Haushalt (PLZ, Personen, Gebäudetyp)
- PV-Anlage
- Stromspeicher
- Wärmepumpe
- E-Mobilität (inkl. Wallbox)
- Großverbraucher (> 4,2 kW)
- Vergleich von statischen und dynamischen Tarifen

## Projektstruktur

- `web-dashboard/` Frontend (HTML, CSS, JS)
- `backend-api/` Node/TypeScript API (Express)
- `netlify/functions/` Serverless Functions für Netlify (`/api/*`)
- `netlify.toml` Netlify Build- und Redirect-Konfiguration

## Lokal starten (VS Code)

### 1) Backend starten

```bash
cd backend-api
npm install
npm run dev
```

Backend läuft dann auf `http://localhost:3001`.

### 2) Frontend starten

`web-dashboard/index.html` mit Live Server in VS Code öffnen.

Das Frontend nutzt automatisch API-Fallbacks:

1. `http://localhost:3001/api`
2. `http://127.0.0.1:3001/api`
3. `/api` (same-origin, z. B. Netlify)

## Netlify Deployment

Die Konfiguration ist in `netlify.toml` enthalten.

- Publish Directory: `web-dashboard`
- API Redirects:
  - `/api/calculate` -> `/.netlify/functions/calculate`
  - `/api/market-live` -> `/.netlify/functions/market-live`
  - `/api/market-history` -> `/.netlify/functions/market-history`
- SPA Fallback: `/*` -> `/index.html`

## Wichtige Hinweise

- Für lokale Entwicklung muss das Backend laufen (`npm run dev` in `backend-api`).
- Für Netlify laufen API-Aufrufe über die Serverless Functions in `netlify/functions/`.
- Wenn sich Logik in `backend-api/src` ändert, sollten Build-Artefakte in `backend-api/dist` aktuell gehalten werden.

## Repository

GitHub: https://github.com/FloverNakamura/Tariflow
