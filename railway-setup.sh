#!/bin/bash
# One-time Railway setup script

echo "🚀 Tariflow Railway Setup"
echo ""

# Step 1: Login to Railway
echo "Step 1: Login to Railway"
echo "→ This will open a browser. Sign in or create a free account."
railway login

# Step 2: Create Railway project
echo ""
echo "Step 2: Creating Railway project..."
railway init --name tariflow-backend

# Step 3: Add backend service
echo ""
echo "Step 3: Building backend..."
cd backend-api || exit 1
npm ci
npm run build

# Step 4: Deploy
echo ""
echo "Step 4: Deploying to Railway..."
railway up

# Step 5: Get the public URL
echo ""
echo "Step 5: Getting deployment URL..."
RAILWAY_URL=$(railway service info tariflow-backend --json 2>/dev/null | jq -r '.publicDomain' || echo "Check Railway dashboard for URL")
echo "✅ Backend deployed to: $RAILWAY_URL"

# Step 6: Get Railway token for GitHub Actions
echo ""
echo "Step 6: Generating GitHub token..."
echo "→ Go to https://railway.app/account/tokens"
echo "→ Create a new token and copy it"
read -p "Paste your Railway token: " RAILWAY_TOKEN

echo ""
echo "📝 Next steps:"
echo "1. Go to GitHub: https://github.com/FloverNakamura/Tariflow/settings/secrets/actions"
echo "2. Click 'New repository secret'"
echo "3. Name: RAILWAY_TOKEN"
echo "4. Value: $RAILWAY_TOKEN"
echo "5. Save"
echo ""
echo "Done! Now updates to backend-api will auto-deploy."
