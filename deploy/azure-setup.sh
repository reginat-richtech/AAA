#!/usr/bin/env bash
# =====================================================================
# AAA web :: one-time Azure setup for the OIDC GitHub-Actions deploy
# ---------------------------------------------------------------------
# Run this AFTER `az login`. It is idempotent (each step checks for an
# existing resource), so it is safe to re-run. It creates:
#   1. a resource group
#   2. a Linux App Service plan + web app (Node 20)
#   3. an Entra app registration GitHub logs in as (OIDC — no password)
#   4. its role assignment (Website Contributor, scoped to just this app)
#   5. a federated credential trusting this repo's `main` branch
# then prints the 3 GitHub secrets (and offers to set them via `gh`).
#
#   az login
#   ./deploy/azure-setup.sh
#
# NOTE: creating the app registration requires permission to register
# apps in your Entra tenant. If step 3 fails with an authorization error,
# ask a tenant admin to run it (or to grant you "Application Developer").
# =====================================================================
set -uo pipefail

# ── EDIT THESE (must match the workflow) ─────────────────────────────
RG=aaa-rg                  # resource group
LOC=eastus                 # region
PLAN=aaa-plan              # app service plan
SKU=F1                     # F1 = Free (shared, no VM quota needed). Upgrade to B1 once you
                           # request vCPU quota:  az appservice plan update -g $RG -n $PLAN --sku B1
APP=aaa-web                # web app name — MUST equal AZURE_WEBAPP_NAME in the workflow
REPO=reginat-richtech/AAA  # owner/repo that runs the workflow
BRANCH=main                # branch the workflow deploys from
# ─────────────────────────────────────────────────────────────────────

command -v az >/dev/null || { echo "ERROR: az not found — run: brew install azure-cli"; exit 1; }
az account show >/dev/null 2>&1 || { echo "ERROR: not logged in — run: az login"; exit 1; }

SUB_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "==> subscription $SUB_ID  /  tenant $TENANT_ID"

# 1) Resource group
az group show -n "$RG" >/dev/null 2>&1 \
  && echo "  ok   resource group $RG (exists)" \
  || { az group create -n "$RG" -l "$LOC" -o none && echo "  new  resource group $RG"; }

# 2) App Service plan (Linux). F1=Free (no VM quota); B1 needs vCPU quota.
az appservice plan show -g "$RG" -n "$PLAN" >/dev/null 2>&1 \
  && echo "  ok   plan $PLAN (exists)" \
  || { az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku "$SKU" -o none && echo "  new  plan $PLAN ($SKU)"; }

# 3) Web app (Node 20)
az webapp show -g "$RG" -n "$APP" >/dev/null 2>&1 \
  && echo "  ok   webapp $APP (exists)" \
  || { az webapp create -g "$RG" -p "$PLAN" -n "$APP" --runtime "NODE:20-lts" -o none && echo "  new  webapp $APP  (https://$APP.azurewebsites.net)"; }

# 4) Entra app registration = the identity GitHub logs in as
APP_ID=$(az ad app list --display-name "github-$APP-deploy" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "github-$APP-deploy" --query appId -o tsv) \
    || { echo "  FAIL could not create app registration (permission?). See NOTE at top."; exit 2; }
  echo "  new  app registration github-$APP-deploy ($APP_ID)"
else
  echo "  ok   app registration github-$APP-deploy ($APP_ID)"
fi
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" -o none

# 5) Role assignment — can deploy to ONLY this web app
SCOPE="/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP"
if az role assignment create --assignee "$APP_ID" --role "Website Contributor" --scope "$SCOPE" -o none 2>/dev/null; then
  echo "  new  role Website Contributor on $APP"
else
  echo "  ok   role already assigned (or still propagating)"
fi

# 6) Federated credential — trust GitHub OIDC tokens for pushes to $BRANCH
SUBJECT="repo:$REPO:ref:refs/heads/$BRANCH"
if az ad app federated-credential list --id "$APP_ID" --query "[?subject=='$SUBJECT']" -o tsv 2>/dev/null | grep -q .; then
  echo "  ok   federated credential (exists)"
else
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"github-$BRANCH\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"$SUBJECT\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none && echo "  new  federated credential ($SUBJECT)"
fi

# 7) The 3 GitHub secrets
echo
echo "==> GitHub secrets (repo → Settings → Secrets and variables → Actions):"
echo "      AZURE_CLIENT_ID        = $APP_ID"
echo "      AZURE_TENANT_ID        = $TENANT_ID"
echo "      AZURE_SUBSCRIPTION_ID  = $SUB_ID"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  read -r -p "  gh is authenticated — set these 3 secrets on $REPO now? [y/N] " ans
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    gh secret set AZURE_CLIENT_ID       -R "$REPO" -b "$APP_ID"     && \
    gh secret set AZURE_TENANT_ID       -R "$REPO" -b "$TENANT_ID"  && \
    gh secret set AZURE_SUBSCRIPTION_ID -R "$REPO" -b "$SUB_ID"     && \
    echo "  done — 3 secrets set on $REPO"
  fi
fi

cat <<EOF

==> STILL TO DO (secrets I can't know — fill in the real values):
  1) App runtime settings (the app crashes on boot without AUTH_*/DB):
       az webapp config appsettings set -g $RG -n $APP --settings \\
         DATABASE_URL="postgresql://app_rw:<pw>@<host>.postgres.database.azure.com:5432/aaa?sslmode=require" \\
         OPENAI_API_KEY="<key>" OPENAI_MODEL="gpt-4.1" \\
         AUTH_SECRET="\$(openssl rand -base64 32)" AUTH_URL="https://$APP.azurewebsites.net" \\
         GOOGLE_CLIENT_ID="<oauth web client id>" GOOGLE_CLIENT_SECRET="<secret>" \\
         ALLOWED_OAUTH_DOMAINS="richtechsystem.com,richtechrobotics.com" \\
         ADMIN_EMAILS="regina.t@richtechsystem.com" \\
         SCM_DO_BUILD_DURING_DEPLOYMENT="false"
  2) Google OAuth client → add redirect URI:
       https://$APP.azurewebsites.net/api/auth/callback/google
  3) Re-run the deploy: GitHub → Actions → "Deploy web" → Run workflow.
EOF
