require('dotenv').config();
const express = require('express');
const path = require('path');
const os = require('os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { OAuth2Client } = require('google-auth-library');
const session = require('express-session');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Paths
const IS_CLOUD_RUN = process.env.K_SERVICE !== undefined;
const DATA_DIR = IS_CLOUD_RUN ? '/tmp' : __dirname;
const USER_CREDS_PATH = path.join(DATA_DIR, '.user_credentials.json');

// OAuth Configuration
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || (IS_CLOUD_RUN ? 'https://ga4-dashboard.lin3s.cloud' : `http://localhost:${PORT}`);
const REDIRECT_URI = `${BASE_URL}/auth/google/callback`;

let oAuth2Client = null;
if (CLIENT_ID && CLIENT_SECRET) {
    oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// MCP Client instance
let mcpClient = null;
let mcpTransport = null;

// Initialize MCP connection
async function initializeMCP() {
    try {
        console.log('Initializing MCP connection to analytics-mcp...');

        let credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

        // Try different credential sources in order
        if (fs.existsSync(USER_CREDS_PATH)) {
            console.log('Using authenticated user credentials from .user_credentials.json');
            credentialsPath = USER_CREDS_PATH;
        } else if (fs.existsSync(path.join(os.homedir(), '.config/gcloud/application_default_credentials.json'))) {
            credentialsPath = path.join(os.homedir(), '.config/gcloud/application_default_credentials.json');
            console.log('Using gcloud application default credentials');
        }

        const env = { ...process.env };
        if (credentialsPath) {
            env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
            console.log('Setting GOOGLE_APPLICATION_CREDENTIALS to:', credentialsPath);
        }
        if (process.env.GOOGLE_CLOUD_PROJECT) {
            env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
        }

        mcpTransport = new StdioClientTransport({
            command: 'analytics-mcp',
            args: [],
            env: env
        });

        mcpClient = new Client({
            name: 'ga4-dashboard',
            version: '1.0.0'
        }, {
            capabilities: {}
        });

        await mcpClient.connect(mcpTransport);
        console.log('✅ Analytics MCP connection established successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize MCP:', error);
        return false;
    }
}

async function closeMCP() {
    if (mcpClient) {
        try {
            await mcpClient.close();
        } catch (e) {
            console.error('Error closing MCP client:', e);
        }
        mcpClient = null;
    }
}

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.userTokens || !req.session.userEmail) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// Routes
app.get('/api/health', async (req, res) => {
    res.json({ status: 'ok', mcpConnected: !!mcpClient });
});

app.get('/auth/login', (req, res) => {
    if (!oAuth2Client) {
        return res.status(500).json({ error: 'OAuth not configured' });
    }
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/analytics.readonly'
        ]
    });
    res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        req.session.userTokens = tokens;

        // Decode ID token to get email
        if (tokens.id_token) {
            const base64Url = tokens.id_token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const decoded = JSON.parse(Buffer.from(base64, 'base64').toString());
            req.session.userEmail = decoded.email;
            req.session.userPicture = decoded.picture || null;
        }

        // Store credentials file for analytics-mcp to use (Google authorized_user format)
        const credsObj = {
            type: 'authorized_user',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: tokens.refresh_token,
            token: tokens.access_token  // Current access token
        };
        fs.writeFileSync(USER_CREDS_PATH, JSON.stringify(credsObj, null, 2));

        // Reinitialize MCP with new credentials
        console.log('Reinitializing MCP with new user credentials...');
        await closeMCP();
        await initializeMCP();

        res.redirect('/');
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.get('/auth/status', (req, res) => {
    if (req.session.userEmail) {
        res.json({
            loggedIn: true,
            email: req.session.userEmail,
            picture: req.session.userPicture
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// API endpoints
app.get('/api/properties', requireAuth, async (req, res) => {
    try {
        if (!mcpClient) {
            return res.status(503).json({ error: 'GA4 connection unavailable' });
        }

        const result = await mcpClient.callTool({ name: 'get_account_summaries', arguments: {} });
        console.log('Raw result:', JSON.stringify(result, null, 2));

        // Check if result contains an error
        if (result.isError) {
            console.error('MCP error:', result.content);
            return res.status(500).json({ error: 'GA4 error: ' + result.content.map(c => c.text).join('\n') });
        }

        let summaries = {};
        if (result.content && result.content.length > 0) {
            // Concatenate all content items (MCP may split response across multiple items)
            let fullText = '';
            result.content.forEach(item => {
                if (item.text) fullText += item.text;
            });
            console.log('Total concatenated text length:', fullText.length);

            try {
                // Try parsing as-is first
                summaries = JSON.parse(fullText);
            } catch (parseErr) {
                console.log('Direct parse failed, trying as array...');
                try {
                    // If direct parse fails, it might be objects split across items
                    // Try wrapping in array brackets
                    summaries = JSON.parse('[' + fullText + ']');
                } catch (parseErr2) {
                    console.error('Failed to parse response (even as array):', fullText.substring(0, 300));
                    return res.status(500).json({ error: 'Failed to parse GA4 response' });
                }
            }
        }

        // Flatten to property list (MCP returns snake_case keys)
        const properties = [];
        console.log('Response type:', typeof summaries, 'Is Array:', Array.isArray(summaries));
        console.log('Response keys:', Object.keys(summaries).slice(0, 10));

        // Handle different response formats
        let accounts = [];
        if (Array.isArray(summaries)) {
            // Response is an array of accounts
            accounts = summaries;
        } else if (summaries.account_summaries) {
            // Response is an object with account_summaries array
            accounts = summaries.account_summaries;
        } else if (summaries.accountSummaries) {
            // Response is an object with accountSummaries array (camelCase)
            accounts = summaries.accountSummaries;
        }

        accounts.forEach(account => {
            const propSummaries = account.property_summaries || account.propertySummaries || [];
            propSummaries.forEach(prop => {
                properties.push({
                    id: prop.property,
                    displayName: prop.display_name || prop.displayName || prop.property
                });
            });
        });

        console.log('Flattened properties count:', properties.length);
        res.json(properties);
    } catch (error) {
        console.error('Error fetching properties:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/metrics', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate, propertyId } = req.query;

        if (!mcpClient) {
            return res.status(503).json({ error: 'GA4 connection unavailable' });
        }

        if (!startDate || !endDate || !propertyId) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Compute previous period
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - diffDays);

        const formatDate = (d) => d.toISOString().split('T')[0];

        // Call 1: Daily trend + KPI totals
        const trendResult = await mcpClient.callTool({ name: 'run_report', arguments: {
            property_id: propertyId.replace('properties/', ''),
            date_ranges: [
                { start_date: startDate, end_date: endDate },
                { start_date: formatDate(prevStart), end_date: formatDate(prevEnd) }
            ],
            dimensions: ['date'],
            metrics: ['sessions', 'totalUsers', 'newUsers', 'screenPageViews']
        } });

        // Parse trend response
        let trendData = [];
        let totalsCurrentPeriod = { sessions: 0, users: 0, newUsers: 0, pageviews: 0 };
        let totalsPrevPeriod = { sessions: 0, users: 0, newUsers: 0, pageviews: 0 };

        if (trendResult.content && trendResult.content[0]) {
            try {
                const parsed = JSON.parse(trendResult.content[0].text);
                if (parsed.rows) {
                    parsed.rows.forEach((row, idx) => {
                        const isCurrentPeriod = idx < parsed.rows.length / 2 || !parsed.rows[parsed.rows.length / 2];
                        const date = row.dimensionValues?.[0]?.value || '';
                        const sessions = parseInt(row.metricValues?.[0]?.value || 0);
                        const users = parseInt(row.metricValues?.[1]?.value || 0);
                        const newUsers = parseInt(row.metricValues?.[2]?.value || 0);
                        const pageviews = parseInt(row.metricValues?.[3]?.value || 0);

                        if (isCurrentPeriod && date !== '') {
                            trendData.push({ date, sessions, users });
                            totalsCurrentPeriod.sessions += sessions;
                            totalsCurrentPeriod.users += users;
                            totalsCurrentPeriod.newUsers += newUsers;
                            totalsCurrentPeriod.pageviews += pageviews;
                        } else if (!isCurrentPeriod && date !== '') {
                            totalsPrevPeriod.sessions += sessions;
                            totalsPrevPeriod.users += users;
                            totalsPrevPeriod.newUsers += newUsers;
                            totalsPrevPeriod.pageviews += pageviews;
                        }
                    });
                }
            } catch (e) {
                console.error('Error parsing trend response:', e);
            }
        }

        // Calculate deltas
        const computeDelta = (current, prev) => {
            if (prev === 0) return current > 0 ? 1.0 : 0;
            return (current - prev) / prev;
        };

        // Call 2: Channel breakdown
        const channelResult = await mcpClient.callTool({ name: 'run_report', arguments: {
            property_id: propertyId.replace('properties/', ''),
            date_ranges: [{ start_date: startDate, end_date: endDate }],
            dimensions: ['sessionDefaultChannelGrouping'],
            metrics: ['sessions']
        } });

        let channels = [];
        if (channelResult.content && channelResult.content[0]) {
            try {
                const parsed = JSON.parse(channelResult.content[0].text);
                if (parsed.rows) {
                    parsed.rows.forEach(row => {
                        const channel = row.dimensionValues?.[0]?.value || 'Other';
                        const sessions = parseInt(row.metricValues?.[0]?.value || 0);
                        channels.push({ channel, sessions });
                    });
                }
            } catch (e) {
                console.error('Error parsing channel response:', e);
            }
        }

        // Build response
        const response = {
            totals: {
                sessions: totalsCurrentPeriod.sessions,
                users: totalsCurrentPeriod.users,
                newUsers: totalsCurrentPeriod.newUsers,
                pageviews: totalsCurrentPeriod.pageviews,
                sessionsDelta: computeDelta(totalsCurrentPeriod.sessions, totalsPrevPeriod.sessions),
                usersDelta: computeDelta(totalsCurrentPeriod.users, totalsPrevPeriod.users),
                newUsersDelta: computeDelta(totalsCurrentPeriod.newUsers, totalsPrevPeriod.newUsers),
                pageviewsDelta: computeDelta(totalsCurrentPeriod.pageviews, totalsPrevPeriod.pageviews)
            },
            trend: trendData,
            channels: channels
        };

        res.json(response);
    } catch (error) {
        console.error('Error fetching metrics:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/top-pages', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate, propertyId } = req.query;

        if (!mcpClient) {
            return res.status(503).json({ error: 'GA4 connection unavailable' });
        }

        if (!startDate || !endDate || !propertyId) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const result = await mcpClient.callTool({ name: 'run_report', arguments: {
            property_id: propertyId.replace('properties/', ''),
            date_ranges: [{ start_date: startDate, end_date: endDate }],
            dimensions: ['pagePath'],
            metrics: ['sessions', 'totalUsers', 'screenPageViews', 'engagementRate'],
            limit: 10,
            order_bys: [{ metric: { metricName: 'sessions' }, descending: true }]
        } });

        let topPages = [];
        if (result.content && result.content[0]) {
            try {
                const parsed = JSON.parse(result.content[0].text);
                if (parsed.rows) {
                    parsed.rows.slice(0, 10).forEach(row => {
                        const pagePath = row.dimensionValues?.[0]?.value || '/';
                        const sessions = parseInt(row.metricValues?.[0]?.value || 0);
                        const users = parseInt(row.metricValues?.[1]?.value || 0);
                        const pageviews = parseInt(row.metricValues?.[2]?.value || 0);
                        const engagementRate = parseFloat(row.metricValues?.[3]?.value || 0);

                        topPages.push({
                            pagePath,
                            sessions,
                            users,
                            pageviews,
                            engagementRate
                        });
                    });
                }
            } catch (e) {
                console.error('Error parsing top pages response:', e);
            }
        }

        res.json(topPages);
    } catch (error) {
        console.error('Error fetching top pages:', error);
        res.status(500).json({ error: error.message });
    }
});

// Catch-all for SPA: return index.html for non-API routes
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Startup
async function start() {
    const mcpReady = await initializeMCP();
    if (!mcpReady) {
        console.warn('⚠️ MCP initialization failed, but server will start anyway');
    }

    app.listen(PORT, () => {
        console.log(`🚀 GA4 Dashboard server running on http://localhost:${PORT}`);
    });

    process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await closeMCP();
        process.exit(0);
    });
}

start();
