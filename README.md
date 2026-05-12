# GA4 Traffic Dashboard

A standalone Google Analytics 4 (GA4) dashboard with a charts-first visual design. Built with Node.js/Express, MCP SDK, and Chart.js.

## Features

- **Traffic overview** — Sessions, users, new users, pageviews with trend comparison
- **Trend chart** — Sessions and users over time (30-day lookback by default)
- **Channel breakdown** — Doughnut chart showing traffic by channel group
- **Top pages table** — Top 10 pages by sessions with engagement metrics
- **Date presets** — 7d, 30d, 90d, or custom date range picker
- **Google OAuth login** — Secure login with your Google account
- **Multi-property support** — Switch between GA4 properties via dropdown

## Prerequisites

- **Node.js 18+**
- **analytics-mcp** installed via pipx: `pipx install analytics-mcp`
- **Google OAuth credentials** from [Google Cloud Console](https://console.cloud.google.com)

## Setup

### 1. Install dependencies

```bash
cd "/Users/igorostiza/GA4 MCP"
npm install
```

### 2. Configure OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable the **Google Analytics API**
4. Create OAuth 2.0 credentials (Web application):
   - Authorized redirect URI: `http://localhost:3001/auth/google/callback`
5. Copy your **Client ID** and **Client Secret**

### 3. Set environment variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
# Edit .env with your Google OAuth Client ID and Client Secret
```

### 4. Start the server

```bash
npm start
```

The dashboard will be available at `http://localhost:3001`.

## Usage

1. **Log in** with your Google account
2. **Select a GA4 property** from the dropdown (auto-populated from your account)
3. **Choose a date range** — 7d, 30d, 90d, or custom dates
4. **View metrics**:
   - Top section: Session/User trend line and channel donut chart
   - Middle: 4 KPI tiles with delta % vs. previous period
   - Bottom: Top 10 pages table

## Architecture

- **Backend**: Express.js + MCP SDK + Google OAuth
- **Frontend**: Vanilla JS + Chart.js
- **Data source**: GA4 via `analytics-mcp`

### Key files

- `server.js` — Express app, OAuth, API endpoints
- `public/index.html` — Dashboard HTML shell
- `public/app.js` — Chart rendering and interaction logic
- `public/styles.css` — Google-style light theme

### API endpoints

- `GET /auth/login` — Redirect to Google OAuth
- `GET /auth/google/callback` — OAuth callback
- `GET /auth/logout` — Clear session
- `GET /auth/status` — Check login status
- `GET /api/properties` — List GA4 properties for user
- `GET /api/metrics?startDate=&endDate=&propertyId=` — Fetch KPI metrics and trend data
- `GET /api/top-pages?startDate=&endDate=&propertyId=` — Fetch top 10 pages

## Troubleshooting

**"MCP connection failed"**
- Check that `analytics-mcp` is installed: `pipx list | grep analytics-mcp`
- Verify `GOOGLE_APPLICATION_CREDENTIALS` or `.user_credentials.json` is valid

**"No properties found"**
- Ensure your Google account has access to at least one GA4 property
- Check that the OAuth scope includes `https://www.googleapis.com/auth/analytics.readonly`

**Charts not rendering**
- Check browser console for JavaScript errors
- Ensure Chart.js CDN is accessible
- Try clearing browser cache and refreshing

## Development

To run in development mode with auto-restart:

```bash
npm run dev
# or use nodemon
npx nodemon server.js
```

## Deployment

The app is Cloud Run compatible. Set `K_SERVICE` env variable to trigger cloud storage paths (`/tmp` instead of local directory).

## License

Built as part of GA4 MCP integration.
