#!/bin/bash
# Manual Railway deployment script (no browser needed)

echo "🚀 Tariflow Backend Deployment to Railway"
echo ""
echo "Prerequisites:"
echo "1. Create free account at https://railway.app"
echo "2. Create a token at https://railway.app/account/tokens"
echo "3. Keep that token ready"
echo ""

read -p "Enter your Railway token: " RAILWAY_TOKEN
export RAILWAY_TOKEN

echo ""
echo "✅ Token set"
echo ""

# Build backend
echo "📦 Building backend..."
cd backend-api || exit 1
npm ci
npm run build

echo ""
echo "🚀 Deploying to Railway..."
railway init --name tariflow-backend
railway up

echo ""
echo "✅ Backend deployed!"
echo ""
echo "Getting your public URL..."
RAILWAY_URL=$(railway service info --json | jq -r '.publicDomain' 2>/dev/null || echo "Check Railway dashboard")
echo "Backend URL: $RAILWAY_URL"

echo ""
echo "📝 Next: Update functions/api/*.js with this URL"
