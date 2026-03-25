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

## Setup (10 min total)

### 1. One-time Railway Setup

```bash
bash railway-setup.sh
# This will:
# 1. Open Railway login
# 2. Build backend
# 3. Deploy to Railway
# 4. Generate a token for GitHub Actions
```

After the script:
- ✅ Backend deployed on Railway
- ⏳ Waiting for you to add `RAILWAY_TOKEN` to GitHub Secrets

### 2. Add GitHub Secret

1. Go to: https://github.com/FloverNakamura/Tariflow/settings/secrets/actions
2. Click **New repository secret**
3. Name: `RAILWAY_TOKEN`
4. Value: *(Paste from railway-setup.sh output)*
5. Save

### 3. Get Your Backend URL

```bash
# After Railway deploys, check:
railway service info tariflow-backend --json | jq '.publicDomain'
# Output: https://tariflow-backend-production.railway.app
```

### 4. Update Function Proxy URLs

Edit `functions/api/*.js` and replace all 3 files:
```js
const BACKEND_URL = 'https://your-railway-url';  // ← Your URL from step 3
```

### 5. Deploy Frontend to Cloudflare Pages

```bash
git add .
git commit -m "update: railway backend url"
git push

# In Cloudflare Dashboard:
# 1. Workers & Pages → Create Application → Connect to Git
# 2. Select: FloverNakamura/Tariflow
# 3. Build Settings:
#    - Build command: cd backend-api && npm ci && npm run build
#    - Build output: web-dashboard
# 4. Deploy
```

Done! Now every push to GitHub auto-deploys everywhere.

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
