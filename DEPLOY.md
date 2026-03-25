# Tariflow Deployment Guide

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Pages (Frontend + Function Proxies)          │
│  ├─ web-dashboard/        (static HTML/CSS/JS)         │
│  └─ functions/api/        (HTTP proxies to backend)    │
│     ├─ calculate.js       → /api/calculate             │
│     ├─ market-live.js     → /api/market-live           │
│     └─ market-history.js  → /api/market-history        │
└─────────────────────────────────────────────────────────┘
         ↓ proxies to
┌─────────────────────────────────────────────────────────┐
│  Railway.app (Backend API)                               │
│  ├─ POST /api/calculate                                 │
│  ├─ GET  /api/market-live                               │
│  └─ GET  /api/market-history?hours=168                  │
└─────────────────────────────────────────────────────────┘
```

## Setup

### 1. Deploy Backend to Railway (5 min)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login to Railway
railway login

# Create & deploy backend
cd backend-api
railway init
railway up
# Copy the deployment URL (e.g., https://tariflow-backend.railway.app)
```

### 2. Update Function Proxy URLs

Edit `functions/api/*.js` and replace:
```js
const BACKEND_URL = 'https://your-railway-url';
```

### 3. Deploy Frontend to Cloudflare Pages

```bash
# Push to GitHub
git push

# In Cloudflare Dashboard:
# 1. Workers & Pages → Create Application → Connect to Git
# 2. Select: FloverNakamura/Tariflow
# 3. Build Settings:
#    - Build command: cd backend-api && npm ci && npm run build
#    - Build output: web-dashboard
# 4. Deploy
```

### 4. Update Backend URL in Frontend (if needed)

If your Railway URL changes:
1. Update `functions/api/*.js` with new URL
2. Commit & push to GitHub
3. Cloudflare re-deploys automatically

## No Local Backend Needed

✅ Frontend: Cloudflare Pages (deployed on git push)  
✅ Backend: Railway (deployed on git push to backend-api + railway up)  
✅ No local server running required

## Maintenance

### Update Backend Logic
```bash
cd backend-api
# Make changes to src/
npm run build
git add dist/
git commit -m "feat: update calculation logic"
railway up  # or git push if Railway linked
```

### Update Frontend
```bash
# Make changes
git add web-dashboard/
git commit -m "fix: ui improvements"
git push  # auto-deploys to Cloudflare
```

### Update Function Proxies
```bash
git add functions/
git commit -m "fix: update backend url"
git push  # auto-deploys to Cloudflare
```

## Environment Variables

Backend API URL is hardcoded in `functions/api/*.js`. To make it dynamic:

1. Set Cloudflare environment variable in Dashboard
2. In functions, use: `const BACKEND_URL = env.BACKEND_URL`

See `.env.example` for reference.
