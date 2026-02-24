/**
 * API Configuration and Data Fetching for WTP Visualization
 *
 * This module handles:
 * - Fetching data from the real API
 * - Transforming API response to visualization format
 * - Automatic polling with configurable interval
 * - Error handling and connection status
 */

// ============================================================================
// MODE-BASED API URL RESOLUTION
// ============================================================================

const API_BASE_URLS = {
    dev:     'https://api-dev-buildot.machinesensiot.xyz',
    staging: 'https://api-staging-buildot.machinesensiot.xyz',
    live:    'https://api.pre.iot.machinesensiot.com'
};

const API_PATHS = {
    data: '/api/Dashboard/GetAssetDevicesData'
};

function getModeFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    if (mode && API_BASE_URLS[mode]) {
        console.log(`API mode: ${mode}`);
        return mode;
    }
    console.error(`Missing or invalid ?mode= parameter. Valid values: dev, staging, live.`);
    return null;
}

const _currentMode = getModeFromUrl();
const _baseUrl = _currentMode ? API_BASE_URLS[_currentMode] : null;

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_CONFIG = {
    // API endpoint resolved from ?mode= query parameter
    dataEndpoint: _baseUrl + API_PATHS.data,

    // Asset ID — read from URL query param ?assetId=..., no hardcoded default
    assetId: null,

    // Bearer token (will be loaded from localStorage or obtained via login)
    bearerToken: null,

    // Storage key for token
    storageKey: 'wtp_bearer_token',

    // Polling interval in milliseconds
    pollingInterval: 3000,

    // Enable/disable API polling on startup
    autoStart: true,

    // Retry settings
    maxRetries: 3,
    retryDelay: 2000
};

// ============================================================================
// STATE
// ============================================================================

let pollingIntervalId = null;
let isPolling = false;
let lastFetchTime = null;
let connectionStatus = 'disconnected';
let consecutiveErrors = 0;
let isAuthenticated = false;

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Load token from localStorage
 */
function loadStoredToken() {
    const token = localStorage.getItem(API_CONFIG.storageKey);
    if (token) {
        API_CONFIG.bearerToken = token;
        isAuthenticated = true;
        console.log('Loaded stored bearer token');
        return true;
    }
    return false;
}

/**
 * Get token from URL parameter
 */
function getTokenFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('auth');
}

/**
 * Get assetId from URL query parameter (?assetId=...)
 */
function getAssetIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('assetId');
    return id ? Number(id) : null;
}

/**
 * Clear stored token (logout)
 */
function clearToken() {
    API_CONFIG.bearerToken = null;
    localStorage.removeItem(API_CONFIG.storageKey);
    isAuthenticated = false;
    console.log('Token cleared');
}

/**
 * Ensure user is authenticated, get token from URL or localStorage.
 * Also resolves assetId from URL query param.
 */
async function ensureAuthenticated() {
    // Resolve assetId from URL
    const urlAssetId = getAssetIdFromUrl();
    if (urlAssetId) {
        API_CONFIG.assetId = urlAssetId;
        console.log(`Asset ID set from URL: ${urlAssetId}`);
    } else {
        console.error('No assetId provided. Please add ?assetId=YOUR_ASSET_ID to the URL');
        throw new Error('No assetId provided in URL');
    }

    // First, try to get token from URL parameter
    const urlToken = getTokenFromUrl();
    if (urlToken) {
        console.log('Token found in URL parameter');
        API_CONFIG.bearerToken = urlToken;
        localStorage.setItem(API_CONFIG.storageKey, urlToken);
        isAuthenticated = true;
        return;
    }

    // Try to load stored token from localStorage
    if (loadStoredToken()) {
        return;
    }

    // No token available
    console.error('No authentication token found. Please provide token via URL parameter: ?auth=YOUR_TOKEN');
    isAuthenticated = false;
    throw new Error('No authentication token provided');
}

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

/**
 * Transform API response to visualization format
 */
function transformApiData(apiResponse) {
    const wtpData = apiResponse?.data?.waterTreatmentPlantComponentsData?.[0];

    if (!wtpData) {
        console.warn('No water treatment plant data found in API response');
        return null;
    }

    return {
        RWT: {
            Level: wtpData.rwtLevel || 0,
            High_Level_Alarm: wtpData.rwtLevelHighAlarm || false,
            Low_Level_Alarm: wtpData.rwtLevelLowAlarm || false,
            Inflow_Rate: wtpData.rwtInflowRate || 0,
            Outflow_Rate: wtpData.rwtOutflowRate || 0,
            pH: parseFloat(wtpData.rwtph) || 7.0,
            Turbidity: wtpData.rwtTurbidity || 0
        },
        CDP: {
            Status: wtpData.cdpStatus || false,
            Mode: wtpData.cdpMode || 'AUTO',
            Dosing_Rate: wtpData.cdpDosingRate || 0,
            Total_Chemical_Used: wtpData.cdpTotalChemicalUsed || 0,
            Pressure: wtpData.cdpPressure || 0,
            Fault: wtpData.cdpFault || false
        },
        CST: {
            Level: wtpData.cstLevel || 0,
            Low_Level_Alarm: wtpData.cstLowLevelAlarm || false
        },
        CFT: {
            Level: wtpData.cftLevel || 0,
            Mixer_Status: wtpData.cftMixerStatus || false,
            pH: parseFloat(wtpData.cftph) || 7.0,
            Turbidity: wtpData.cftTurbidity || 0,
            Dosing_Rate: wtpData.cftDosingRate || 0
        },
        // SCT: Single tank values (API provides single value, visualization has 2 tanks)
        // Both tanks use the same API value
        SCT: [
            {
                Level: wtpData.sctLevel || 0,
                Sludge_Level: wtpData.sctSludgeLevel || 0,
                Turbidity_Outlet: wtpData.sctTurbidityOutlet || 0,
                Scraper_Status: wtpData.sctScraperStatus || false
            },
            {
                Level: wtpData.sctLevel || 0,
                Sludge_Level: wtpData.sctSludgeLevel || 0,
                Turbidity_Outlet: wtpData.sctTurbidityOutlet || 0,
                Scraper_Status: wtpData.sctScraperStatus || false
            }
        ],
        FTR: {
            Differential_Pressure: wtpData.ftrDifferentialPressure || 0,
            Flow_Rate: wtpData.ftrFlowRate || 0,
            Backwash_Status: wtpData.ftrBackwashStatus || false
        },
        // CWT: Single tank values (API provides single value, visualization has 2 tanks)
        // Both tanks use the same API value
        CWT: [
            {
                Level: wtpData.cwtLevel || 0,
                High_Level_Alarm: wtpData.cwtLevelHighAlarm || false,
                Low_Level_Alarm: wtpData.cwtLevelLowAlarm || false,
                pH: parseFloat(wtpData.cwtph) || 7.0,
                Turbidity: wtpData.cwtTurbidity || 0,
                Residual_Chlorine: wtpData.cwtResidualChlorine || 0
            },
            {
                Level: wtpData.cwtLevel || 0,
                High_Level_Alarm: wtpData.cwtLevelHighAlarm || false,
                Low_Level_Alarm: wtpData.cwtLevelLowAlarm || false,
                pH: parseFloat(wtpData.cwtph) || 7.0,
                Turbidity: wtpData.cwtTurbidity || 0,
                Residual_Chlorine: wtpData.cwtResidualChlorine || 0
            }
        ],
        SLT: {
            Level: wtpData.sltLevel || 0,
            Pump_Status: wtpData.sltPumpStatus || false
        },
        PPS: {
            Status: wtpData.ppsPumpStatus || false,
            Mode: wtpData.ppsMode || 'AUTO',
            Flow_Rate: wtpData.ppsFlowRate || 0,
            Outlet_Pressure: wtpData.ppsOutletPressure || 0,
            Fault: wtpData.ppsFault || false
        },
        PLT: {
            Total_Inflow: wtpData.pltTotalInflow || 0,
            Total_Outflow: wtpData.pltTotalOutflow || 0,
            System_Mode: wtpData.pltSystemMode || 'AUTO',
            Alarm_Status: wtpData.pltAlarmStatus || false
        }
    };
}

// ============================================================================
// API FETCHING
// ============================================================================

async function fetchPlantData() {
    if (!_baseUrl) {
        throw new Error('No valid API base URL — invalid or missing ?mode= parameter');
    }
    const url = `${API_CONFIG.dataEndpoint}?assetId=${API_CONFIG.assetId}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': '*/*',
                'Authorization': `Bearer ${API_CONFIG.bearerToken}`
            },
            mode: 'cors'
        });

        if (!response.ok) {
            if (response.status === 401) {
                console.error('Authentication failed - token is invalid or expired');
                console.error('Please reload the page with a valid token: ?auth=YOUR_TOKEN');
                clearToken();
                stopPolling();

                const dataSource = document.getElementById('data-source');
                if (dataSource) {
                    dataSource.textContent = 'Data: Invalid Token';
                    dataSource.style.color = '#ff5252';
                }

                throw new Error('Authentication failed - invalid or expired token');
            }

            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'API returned unsuccessful response');
        }

        const transformedData = transformApiData(data);

        if (!transformedData) {
            throw new Error('Failed to transform API data');
        }

        connectionStatus = 'connected';
        consecutiveErrors = 0;
        lastFetchTime = new Date();
        updateConnectionIndicator();

        return transformedData;

    } catch (error) {
        console.error('Error fetching plant data:', error);
        consecutiveErrors++;

        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            connectionStatus = 'disconnected';
        } else {
            connectionStatus = 'error';
        }

        updateConnectionIndicator();

        if (consecutiveErrors >= API_CONFIG.maxRetries) {
            console.error(`Stopping polling after ${consecutiveErrors} consecutive errors`);
            stopPolling();
        }

        throw error;
    }
}

async function fetchAndUpdate() {
    try {
        const plantData = await fetchPlantData();

        if (window.WTPVisualizer) {
            window.WTPVisualizer.updatePlantData(plantData);
        } else {
            console.warn('WTPVisualizer not found');
        }

    } catch (error) {
        console.error('Failed to fetch and update:', error);
    }
}

// ============================================================================
// POLLING CONTROL
// ============================================================================

function startPolling() {
    if (isPolling) {
        console.log('Polling already active');
        return;
    }

    console.log(`Starting WTP API polling every ${API_CONFIG.pollingInterval}ms`);
    isPolling = true;

    fetchAndUpdate();
    pollingIntervalId = setInterval(fetchAndUpdate, API_CONFIG.pollingInterval);

    updateConnectionIndicator();
}

function stopPolling() {
    if (!isPolling) {
        console.log('Polling not active');
        return;
    }

    console.log('Stopping API polling');
    isPolling = false;

    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    connectionStatus = 'disconnected';
    updateConnectionIndicator();
}

function togglePolling() {
    if (isPolling) {
        stopPolling();
    } else {
        startPolling();
    }
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateConnectionIndicator() {
    const statusText = document.getElementById('api-status-text');
    const statusDot = document.getElementById('api-status-dot');
    const lastUpdate = document.getElementById('api-last-update');
    const dataSource = document.getElementById('data-source');

    if (statusDot) {
        statusDot.className = 'status-dot';
        if (connectionStatus === 'connected') {
            statusDot.classList.add('connected');
        } else if (connectionStatus === 'disconnected') {
            statusDot.classList.add('disconnected');
        } else {
            statusDot.classList.add('error');
        }
    }

    if (statusText) {
        if (connectionStatus === 'connected') {
            statusText.textContent = 'Live Data';
        } else if (connectionStatus === 'disconnected') {
            statusText.textContent = 'Disconnected';
        } else {
            statusText.textContent = 'Error';
        }
    }

    if (lastUpdate && lastFetchTime) {
        const timeAgo = Math.floor((Date.now() - lastFetchTime.getTime()) / 1000);
        lastUpdate.textContent = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.floor(timeAgo / 60)}m ago`;
    }

    if (dataSource) {
        if (isPolling && connectionStatus === 'connected') {
            dataSource.textContent = 'Data: Live API';
            dataSource.style.color = '#69f0ae';
        } else if (isPolling && connectionStatus === 'error') {
            dataSource.textContent = 'Data: API Error';
            dataSource.style.color = '#ff5252';
        } else {
            dataSource.textContent = 'Data: Simulation';
            dataSource.style.color = '#ffd740';
        }
    }
}

// Update "time ago" every second
setInterval(() => {
    if (lastFetchTime) {
        updateConnectionIndicator();
    }
}, 1000);

// ============================================================================
// CONNECTION INDICATOR UI
// ============================================================================

function createConnectionIndicator() {
    if (document.getElementById('api-status-indicator')) return;

    const indicator = document.createElement('div');
    indicator.id = 'api-status-indicator';
    indicator.innerHTML = `
        <div style="
            position: absolute;
            top: 60px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            padding: 8px 15px;
            border-radius: 8px;
            z-index: 100;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        ">
            <div id="api-status-dot" class="status-dot disconnected"></div>
            <div style="display: flex; flex-direction: column;">
                <span id="api-status-text" style="color: #fff; font-weight: bold;">Disconnected</span>
                <span id="api-last-update" style="color: #888; font-size: 10px;">Never</span>
            </div>
            <button id="api-toggle-btn" style="
                background: #4fc3f7;
                border: none;
                color: #000;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 10px;
                margin-left: 5px;
            ">Start</button>
        </div>

        <style>
            .status-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                animation: pulse 2s infinite;
            }
            .status-dot.connected {
                background: #69f0ae;
            }
            .status-dot.disconnected {
                background: #616161;
                animation: none;
            }
            .status-dot.error {
                background: #ff5252;
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        </style>
    `;

    document.body.appendChild(indicator);

    const toggleBtn = document.getElementById('api-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            togglePolling();
            toggleBtn.textContent = isPolling ? 'Stop' : 'Start';
            toggleBtn.style.background = isPolling ? '#ff5252' : '#4fc3f7';
        });
    }

    if (API_CONFIG.autoStart) {
        setTimeout(() => {
            if (toggleBtn) {
                toggleBtn.textContent = 'Stop';
                toggleBtn.style.background = '#ff5252';
            }
        }, 1100);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initAPI() {
    console.log('WTP API Integration initialized');

    createConnectionIndicator();

    // Abort immediately if mode is invalid — do not show static data
    if (!_currentMode) {
        connectionStatus = 'error';
        updateConnectionIndicator();
        const dataSource = document.getElementById('data-source');
        if (dataSource) {
            dataSource.textContent = 'Data: Invalid Mode';
            dataSource.style.color = '#ff5252';
        }
        if (window.WTPVisualizer) window.WTPVisualizer.clearData();
        return;
    }

    try {
        await ensureAuthenticated();

        if (API_CONFIG.autoStart) {
            setTimeout(() => {
                startPolling();
            }, 1000);
        }
    } catch (error) {
        console.error('Authentication failed:', error);
        connectionStatus = 'error';
        updateConnectionIndicator();

        const dataSource = document.getElementById('data-source');
        if (dataSource) {
            const isNoAsset = error.message.includes('assetId');
            dataSource.textContent = isNoAsset ? 'Data: No Asset ID' : 'Data: No Token';
            dataSource.style.color = '#ff5252';
        }

        // Ensure the visualizer shows no data (not static defaults)
        if (window.WTPVisualizer) window.WTPVisualizer.clearData();
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

window.WTPAPI = {
    clearToken,
    ensureAuthenticated,
    isAuthenticated: () => isAuthenticated,

    startPolling,
    stopPolling,
    togglePolling,
    fetchPlantData,
    transformApiData,

    getConnectionStatus: () => connectionStatus,
    getLastFetchTime: () => lastFetchTime,
    isPolling: () => isPolling,

    config: API_CONFIG
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAPI);
} else {
    initAPI();
}
