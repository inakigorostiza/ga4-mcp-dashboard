# GA4 Dashboard Deployment Guide

This guide covers deploying the GA4 Dashboard with:
- **Frontend:** GitHub Pages (static hosting)
- **Backend:** Google Cloud Run (serverless)

## Prerequisites

1. Google Cloud Project with billing enabled
2. GitHub account with repository access
3. `gcloud` CLI installed and configured
4. Google OAuth credentials (Client ID and Secret)

## Step 1: Enable GitHub Pages

1. Go to your GitHub repository: https://github.com/inakigorostiza/ga4-mcp-dashboard
2. Navigate to **Settings** → **Pages**
3. Set **Source** to `Deploy from a branch`
4. Select branch: `main` and folder: `/docs` (we'll use root instead)
5. Save

Actually, since we're deploying from `/public`, update the GitHub Actions workflow or let us know which branch/folder to use.

## Step 2: Set up Google Cloud Project

```bash
# Set your project ID
export PROJECT_ID="your-google-cloud-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# Create a service account for Cloud Run deployment
gcloud iam service-accounts create ga4-dashboard-runner \
    --display-name="GA4 Dashboard Runner"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:ga4-dashboard-runner@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.admin"
```

## Step 3: Set Environment Secrets in Cloud Build

Store sensitive information in Secret Manager:

```bash
# Store Google OAuth credentials
echo -n "YOUR_GOOGLE_CLIENT_ID" | gcloud secrets create google-client-id --data-file=-
echo -n "YOUR_GOOGLE_CLIENT_SECRET" | gcloud secrets create google-client-secret --data-file=-
echo -n "YOUR_SESSION_SECRET" | gcloud secrets create session-secret --data-file=-

# Grant Cloud Build access to secrets
gcloud secrets add-iam-policy-binding google-client-id \
    --member="serviceAccount:${PROJECT_ID}@cloudbuild.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding google-client-secret \
    --member="serviceAccount:${PROJECT_ID}@cloudbuild.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding session-secret \
    --member="serviceAccount:${PROJECT_ID}@cloudbuild.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

## Step 4: Update OAuth Consent Screen

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **OAuth consent screen**
3. Add authorized JavaScript origins:
   - `https://inakigorostiza.github.io`
   - `https://ga4-dashboard-[service-name].run.app` (after deployment)
4. Add authorized redirect URIs:
   - Backend Cloud Run URL + `/auth/google/callback`

## Step 5: Deploy Backend to Cloud Run

### Option A: Manual deployment via gcloud

```bash
# Build and deploy directly
gcloud run deploy ga4-dashboard \
    --source . \
    --region us-central1 \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars="GOOGLE_CLIENT_ID=YOUR_CLIENT_ID,GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET,SESSION_SECRET=YOUR_SESSION_SECRET,GOOGLE_CLOUD_PROJECT=$PROJECT_ID" \
    --memory 512Mi \
    --timeout 3600
```

### Option B: Via Cloud Build (recommended for CI/CD)

```bash
# Create cloudbuild.yaml with secrets substitution
gcloud builds submit \
    --config=cloudbuild.yaml \
    --substitutions=_GOOGLE_CLIENT_ID="YOUR_CLIENT_ID",_GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET",_SESSION_SECRET="YOUR_SESSION_SECRET"
```

## Step 6: Update Frontend Configuration

After Cloud Run deployment, you'll get a URL like:
```
https://ga4-dashboard-xxxxx.run.app
```

Update `public/index.html` with the correct backend URL:

```javascript
// In the <script> tag
function getApiUrl(endpoint) {
    const baseUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001'
        : 'https://ga4-dashboard-xxxxx.run.app'; // Update with your Cloud Run URL
    return `${baseUrl}${endpoint}`;
}
```

## Step 7: Deploy Frontend to GitHub Pages

The frontend automatically deploys when you push to `main`:

```bash
git add -A
git commit -m "Update backend URL for production"
git push origin main
```

Monitor deployment at: https://github.com/inakigorostiza/ga4-mcp-dashboard/actions

## Step 8: Update OAuth Redirect URIs

Once you have both URLs:

1. Go to [Google Cloud Console OAuth Credentials](https://console.cloud.google.com/apis/credentials)
2. Edit your OAuth 2.0 Client ID
3. Add redirect URI:
   - `https://ga4-dashboard-xxxxx.run.app/auth/google/callback`
4. Save

## Verification

1. Frontend: https://inakigorostiza.github.io/ga4-mcp-dashboard/
2. Click "Sign in with Google"
3. Authenticate with your Google account
4. You should see your GA4 properties loaded

## Troubleshooting

### CORS errors in browser console

Make sure the backend URL in `public/index.html` matches your Cloud Run deployment URL.

### "Not authenticated" errors

Ensure:
- Session cookies are being sent (`credentials: 'include'` in fetch)
- CORS header `Access-Control-Allow-Credentials: true` is set
- Cookie `sameSite: 'none'` and `secure: true` are configured

### Cloud Run cold starts

Cloud Run may take 10-30 seconds on first request after inactivity.

### OAuth redirect mismatch

If you see "redirect_uri_mismatch", verify the redirect URI in Google Cloud Console matches exactly:
- `https://[cloud-run-url]/auth/google/callback`

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port (set to 8080 in Cloud Run) | 8080 |
| `GOOGLE_CLIENT_ID` | OAuth Client ID | abc123... |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret | xyz789... |
| `SESSION_SECRET` | Session encryption key | random-secret |
| `GOOGLE_CLOUD_PROJECT` | GCP Project ID | my-project-123 |
| `FRONTEND_URL` | Frontend GitHub Pages URL | https://inakigorostiza.github.io |

## Scaling & Costs

- **Cloud Run:** First 2M requests/month free, $0.40 per 1M requests after
- **GitHub Pages:** Always free
- **Cloud Build:** First 120 build-minutes/day free, $0.003 per build-minute after

## Cleanup

To remove Cloud Run service:

```bash
gcloud run services delete ga4-dashboard --region us-central1
```

