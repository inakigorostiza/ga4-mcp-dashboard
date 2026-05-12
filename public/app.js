// Chart instances
let trendChart = null;
let channelChart = null;

// Current state
let currentProperty = null;
let currentStartDate = null;
let currentEndDate = null;

// API helper
function getApiUrl(endpoint) {
    // For Vercel: same domain, use relative URLs
    // For localhost: use http://localhost:3001
    // For GitHub Pages + Cloud Run: use cloud run URL
    if (window.location.hostname === 'localhost') {
        return `http://localhost:3001${endpoint}`;
    } else if (window.location.hostname.includes('vercel.app')) {
        // Vercel: use relative URLs (same domain)
        return endpoint;
    } else if (window.location.hostname.includes('github.io')) {
        // GitHub Pages: use Cloud Run backend
        return `${window.location.protocol}//ga4-dashboard-xxxxx.run.app${endpoint}`;
    }
    // Default: relative URL
    return endpoint;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupEventListeners();
});

async function checkAuth() {
    try {
        const response = await fetch(getApiUrl('/auth/status'));
        const data = await response.json();

        if (data.loggedIn) {
            document.getElementById('loginPrompt').style.display = 'none';
            document.getElementById('dashboardContent').style.display = 'block';
            document.getElementById('userInfo').textContent = data.email;
            await loadProperties();
            setDefaultDateRange();
            if (currentProperty) {
                await loadDashboard();
            }
        } else {
            document.getElementById('loginPrompt').style.display = 'flex';
            document.getElementById('dashboardContent').style.display = 'none';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        document.getElementById('loginPrompt').style.display = 'flex';
    }
}

async function loadProperties() {
    try {
        const response = await fetch(getApiUrl('/api/properties'), { credentials: 'include' });
        console.log('Properties response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Properties fetch failed:', response.status, errorText);
            throw new Error(`Failed to load properties: ${response.status}`);
        }

        const properties = await response.json();
        console.log('Loaded properties:', properties);

        const select = document.getElementById('propertySelect');
        select.innerHTML = '';

        if (!properties || properties.length === 0) {
            console.warn('No properties returned from API');
            select.innerHTML = '<option value="">No properties available</option>';
            return;
        }

        properties.forEach(prop => {
            console.log('Adding property option:', prop.id, prop.displayName);
            const option = document.createElement('option');
            option.value = prop.id;
            option.textContent = prop.displayName || prop.id;
            select.appendChild(option);
        });

        if (properties.length > 0) {
            select.value = properties[0].id;
            currentProperty = properties[0].id;
            console.log('Selected first property:', currentProperty);
        }
    } catch (error) {
        console.error('Error loading properties:', error);
        const select = document.getElementById('propertySelect');
        select.innerHTML = '<option value="">Error: ' + error.message + '</option>';
    }
}

function setDefaultDateRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 29); // 30 days
    currentStartDate = formatDate(start);
    currentEndDate = formatDate(end);
    updateDateRangeDisplay();
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function updateDateRangeDisplay() {
    const start = new Date(currentStartDate);
    const end = new Date(currentEndDate);
    const options = { month: 'short', day: 'numeric' };
    document.getElementById('dateRange').textContent =
        `${start.toLocaleDateString('en-US', options)} – ${end.toLocaleDateString('en-US', options)}`;
}

function setupEventListeners() {
    document.getElementById('propertySelect').addEventListener('change', (e) => {
        currentProperty = e.target.value;
        loadDashboard();
    });

    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const preset = e.target.dataset.preset;
            if (preset === 'custom') {
                document.getElementById('customDatePicker').style.display = 'flex';
            } else {
                document.getElementById('customDatePicker').style.display = 'none';
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - (parseInt(preset) - 1));
                currentStartDate = formatDate(start);
                currentEndDate = formatDate(end);
                updateDateRangeDisplay();
                loadDashboard();
            }
        });
    });

    document.getElementById('applyDateBtn').addEventListener('click', () => {
        const startInput = document.getElementById('startDate').value;
        const endInput = document.getElementById('endDate').value;
        if (startInput && endInput) {
            currentStartDate = startInput;
            currentEndDate = endInput;
            updateDateRangeDisplay();
            loadDashboard();
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        window.location.href = getApiUrl('/auth/logout');
    });
}

async function loadDashboard() {
    if (!currentProperty) return;

    document.getElementById('loadingState').style.display = 'flex';
    document.getElementById('dashboardContent').style.display = 'none';

    try {
        const params = new URLSearchParams({
            startDate: currentStartDate,
            endDate: currentEndDate,
            propertyId: currentProperty
        });

        const [metricsRes, pagesRes] = await Promise.all([
            fetch(getApiUrl(`/api/metrics?${params}`), { credentials: 'include' }),
            fetch(getApiUrl(`/api/top-pages?${params}`), { credentials: 'include' })
        ]);

        if (!metricsRes.ok || !pagesRes.ok) {
            throw new Error('Failed to fetch data');
        }

        const metrics = await metricsRes.json();
        const topPages = await pagesRes.json();

        renderMetrics(metrics);
        renderTrendChart(metrics.trend);
        renderChannelChart(metrics.channels);
        renderTopPages(topPages);

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('dashboardContent').style.display = 'block';
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('loadingState').style.display = 'none';
        alert('Error loading dashboard: ' + error.message);
    }
}

function renderMetrics(metrics) {
    const formatNumber = (n) => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toString();
    };

    const formatDelta = (delta) => {
        const percent = Math.round(delta * 100);
        const sign = delta > 0 ? '▲' : '▼';
        const color = delta > 0 ? '#34a853' : '#ea4335';
        return `<span style="color:${color};">${sign} ${Math.abs(percent)}%</span>`;
    };

    document.getElementById('kpiSessions').textContent = formatNumber(metrics.totals.sessions);
    document.getElementById('kpiSessionsDelta').innerHTML = `${formatDelta(metrics.totals.sessionsDelta)} vs prev period`;

    document.getElementById('kpiUsers').textContent = formatNumber(metrics.totals.users);
    document.getElementById('kpiUsersDelta').innerHTML = `${formatDelta(metrics.totals.usersDelta)} vs prev period`;

    document.getElementById('kpiNewUsers').textContent = formatNumber(metrics.totals.newUsers);
    document.getElementById('kpiNewUsersDelta').innerHTML = `${formatDelta(metrics.totals.newUsersDelta)} vs prev period`;

    document.getElementById('kpiPageviews').textContent = formatNumber(metrics.totals.pageviews);
    document.getElementById('kpiPageviewsDelta').innerHTML = `${formatDelta(metrics.totals.pageviewsDelta)} vs prev period`;
}

function renderTrendChart(trend) {
    const ctx = document.getElementById('trendChart').getContext('2d');

    if (trendChart) {
        trendChart.destroy();
    }

    const labels = trend.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const sessionData = trend.map(d => d.sessions);
    const userData = trend.map(d => d.users);

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Sessions',
                    data: sessionData,
                    borderColor: '#1a73e8',
                    backgroundColor: 'rgba(26, 115, 232, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: 'Users',
                    data: userData,
                    borderColor: '#34a853',
                    borderDash: [6, 3],
                    fill: false,
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f3f4' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function renderChannelChart(channels) {
    const ctx = document.getElementById('channelChart').getContext('2d');

    if (channelChart) {
        channelChart.destroy();
    }

    const colors = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#a142f4'];
    const labels = channels.map(c => c.channel);
    const data = channels.map(c => c.sessions);

    channelChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            }
        }
    });

    // Render legend
    const legendDiv = document.getElementById('channelLegend');
    legendDiv.innerHTML = '';
    channels.forEach((channel, idx) => {
        const item = document.createElement('div');
        item.className = 'channel-legend-item';
        item.style.color = colors[idx];
        item.innerHTML = `
            <span class="legend-color" style="background:${colors[idx]};"></span>
            <span class="legend-name">${channel.channel}</span>
            <span class="legend-pct">${((channel.sessions / data.reduce((a, b) => a + b)) * 100).toFixed(0)}%</span>
        `;
        legendDiv.appendChild(item);
    });
}

function renderTopPages(pages) {
    const tbody = document.getElementById('topPagesBody');
    tbody.innerHTML = '';

    if (pages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#80868b;">No data</td></tr>';
        return;
    }

    pages.forEach(page => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="path-cell"><a href="${page.pagePath}" target="_blank" rel="noopener">${page.pagePath}</a></td>
            <td class="num-cell">${page.sessions.toLocaleString()}</td>
            <td class="num-cell">${page.users.toLocaleString()}</td>
            <td class="num-cell">${page.pageviews.toLocaleString()}</td>
            <td class="num-cell">${(page.engagementRate * 100).toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    });
}
