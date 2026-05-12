// API Configuration
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://ga4-dashboard-backend.cloudfunctions.net'; // Will be updated after Cloud Run deployment

const API_ENDPOINTS = {
  health: `${API_BASE_URL}/api/health`,
  properties: `${API_BASE_URL}/api/properties`,
  metrics: `${API_BASE_URL}/api/metrics`,
  topPages: `${API_BASE_URL}/api/top-pages`,
  auth: {
    status: `${API_BASE_URL}/auth/status`,
    login: `${API_BASE_URL}/auth/login`,
    logout: `${API_BASE_URL}/auth/logout`,
    callback: `${API_BASE_URL}/auth/google/callback`
  }
};

console.log('API Base URL:', API_BASE_URL);
