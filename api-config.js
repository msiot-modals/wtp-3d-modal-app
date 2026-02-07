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
// CONFIGURATION
// ============================================================================

const API_CONFIG = {
    // API endpoints
    authEndpoint: 'https://dev.auth.machinesensiot.com/api/Auth/Login',
    dataEndpoint: 'https://api-staging-buildot.machinesensiot.xyz/api/Dashboard/GetAssetDevicesData',

    // Asset ID to fetch
    assetId: 6141,

    // Bearer token (will be loaded from localStorage or obtained via login)
    bearerToken: null,

    // Storage key for token
    storageKey: 'wtp_bearer_token',

    // Polling interval in milliseconds (3 seconds = 3000ms)
    pollingInterval: 3000,

    // Enable/disable API polling on startup
    autoStart: true,

    // Retry settings
    maxRetries: 3,
    retryDelay: 2000 // ms
};

// ============================================================================
// STATE
// ============================================================================

let pollingIntervalId = null;
let isPolling = false;
let lastFetchTime = null;
let connectionStatus = 'disconnected'; // 'connected', 'disconnected', 'error'
let consecutiveErrors = 0;
let isAuthenticated = false;

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Login to get bearer token
 * @param {string} username
 * @param {string} password
 * @returns {Promise<string>} Bearer token
 */
async function login(username, password) {
    try {
        const response = await fetch(API_CONFIG.authEndpoint, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            throw new Error(`Login failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success || !data.data?.accessToken) {
            throw new Error(data.message || 'Login failed: No access token received');
        }

        const token = data.data.accessToken;

        // Store token
        API_CONFIG.bearerToken = token;
        localStorage.setItem(API_CONFIG.storageKey, token);
        isAuthenticated = true;

        console.log('Login successful');
        return token;

    } catch (error) {
        console.error('Login error:', error);
        throw error;
    }
}

/**
 * Load token from localStorage
 * @returns {boolean} True if token was loaded
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
 * Clear stored token (logout)
 */
function clearToken() {
    API_CONFIG.bearerToken = null;
    localStorage.removeItem(API_CONFIG.storageKey);
    isAuthenticated = false;
    console.log('Token cleared');
}

/**
 * Show login modal to get credentials
 * @returns {Promise<void>}
 */
function showLoginModal() {
    return new Promise((resolve, reject) => {
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'login-modal';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            ">
                <div style="
                    background: #1a1a2e;
                    padding: 30px;
                    border-radius: 12px;
                    border: 2px solid #4fc3f7;
                    max-width: 400px;
                    width: 90%;
                ">
                    <h2 style="color: #4fc3f7; margin-bottom: 20px; text-align: center;">Login Required</h2>
                    <p style="color: #aaa; margin-bottom: 20px; font-size: 14px; text-align: center;">
                        Enter your credentials to access the Water Treatment Plant API
                    </p>

                    <form id="login-form">
                        <div style="margin-bottom: 15px;">
                            <label style="color: #fff; display: block; margin-bottom: 5px; font-size: 14px;">Username</label>
                            <input
                                type="text"
                                id="login-username"
                                required
                                style="
                                    width: 100%;
                                    padding: 10px;
                                    background: #0f0f1e;
                                    border: 1px solid #4fc3f7;
                                    border-radius: 4px;
                                    color: #fff;
                                    font-size: 14px;
                                "
                            />
                        </div>

                        <div style="margin-bottom: 20px;">
                            <label style="color: #fff; display: block; margin-bottom: 5px; font-size: 14px;">Password</label>
                            <input
                                type="password"
                                id="login-password"
                                required
                                style="
                                    width: 100%;
                                    padding: 10px;
                                    background: #0f0f1e;
                                    border: 1px solid #4fc3f7;
                                    border-radius: 4px;
                                    color: #fff;
                                    font-size: 14px;
                                "
                            />
                        </div>

                        <div id="login-error" style="
                            color: #ff5252;
                            margin-bottom: 15px;
                            font-size: 13px;
                            display: none;
                            text-align: center;
                        "></div>

                        <button
                            type="submit"
                            id="login-submit-btn"
                            style="
                                width: 100%;
                                padding: 12px;
                                background: #4fc3f7;
                                border: none;
                                border-radius: 4px;
                                color: #000;
                                font-weight: bold;
                                font-size: 14px;
                                cursor: pointer;
                                transition: background 0.3s;
                            "
                        >
                            Login
                        </button>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const form = document.getElementById('login-form');
        const usernameInput = document.getElementById('login-username');
        const passwordInput = document.getElementById('login-password');
        const errorDiv = document.getElementById('login-error');
        const submitBtn = document.getElementById('login-submit-btn');

        // Focus username field
        setTimeout(() => usernameInput.focus(), 100);

        // Handle form submission
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const username = usernameInput.value.trim();
            const password = passwordInput.value;

            if (!username || !password) {
                errorDiv.textContent = 'Please enter both username and password';
                errorDiv.style.display = 'block';
                return;
            }

            // Disable form
            submitBtn.disabled = true;
            submitBtn.textContent = 'Logging in...';
            submitBtn.style.background = '#81d4fa';
            errorDiv.style.display = 'none';

            try {
                // Attempt login
                await login(username, password);

                // Success - close modal
                document.body.removeChild(modal);
                resolve();

            } catch (error) {
                // Show error
                errorDiv.textContent = error.message || 'Login failed. Please try again.';
                errorDiv.style.display = 'block';

                // Re-enable form
                submitBtn.disabled = false;
                submitBtn.textContent = 'Login';
                submitBtn.style.background = '#4fc3f7';
                passwordInput.value = '';
                passwordInput.focus();
            }
        });
    });
}

/**
 * Get token from URL parameter
 * @returns {string|null} Token from URL or null
 */
function getTokenFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('auth');
}

/**
 * Ensure user is authenticated, get token from URL or localStorage
 * @returns {Promise<void>}
 */
async function ensureAuthenticated() {
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

    // No token available - log error and don't start polling
    console.error('No authentication token found. Please provide token via URL parameter: ?auth=YOUR_TOKEN');
    isAuthenticated = false;
    throw new Error('No authentication token provided');
}

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

/**
 * Transform API response to visualization format
 * @param {Object} apiResponse - Raw API response
 * @returns {Object} Transformed data for visualization
 */
function transformApiData(apiResponse) {
    // Extract the water treatment plant data
    const wtpData = apiResponse?.data?.waterTreatmentPlantComponentsData?.[0];

    if (!wtpData) {
        console.warn('No water treatment plant data found in API response');
        return null;
    }

    // Transform to visualization format
    // Note: For tanks with 2 instances (SCT, CWT), we're using single values from API
    // You may need to adjust this if you want different values for each tank
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

/**
 * Fetch data from the API
 * @returns {Promise<Object>} Transformed plant data
 */
async function fetchPlantData() {
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
            // Handle 401 Unauthorized - token expired or invalid
            if (response.status === 401) {
                console.error('Authentication failed - token is invalid or expired');
                console.error('Please reload the page with a valid token: ?auth=YOUR_TOKEN');
                clearToken();
                stopPolling();

                // Update UI to show authentication error
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

        // Check if API returned success
        if (!data.success) {
            throw new Error(data.message || 'API returned unsuccessful response');
        }

        // Transform and return data
        const transformedData = transformApiData(data);

        if (!transformedData) {
            throw new Error('Failed to transform API data');
        }

        // Update connection status
        connectionStatus = 'connected';
        consecutiveErrors = 0;
        lastFetchTime = new Date();
        updateConnectionIndicator();

        return transformedData;

    } catch (error) {
        console.error('Error fetching plant data:', error);
        consecutiveErrors++;

        // Update connection status
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            connectionStatus = 'disconnected';
        } else {
            connectionStatus = 'error';
        }

        updateConnectionIndicator();

        // Stop polling after too many consecutive errors
        if (consecutiveErrors >= API_CONFIG.maxRetries) {
            console.error(`Stopping polling after ${consecutiveErrors} consecutive errors`);
            stopPolling();
        }

        throw error;
    }
}

/**
 * Fetch and update visualization with API data
 */
async function fetchAndUpdate() {
    try {
        const plantData = await fetchPlantData();

        // Update the visualization
        if (window.WTPVisualizer) {
            window.WTPVisualizer.updatePlantData(plantData);
        } else {
            console.warn('WTPVisualizer not found. Make sure wtp-visualizer.js is loaded.');
        }

    } catch (error) {
        console.error('Failed to fetch and update:', error);
        // Error is already handled in fetchPlantData
    }
}

// ============================================================================
// POLLING CONTROL
// ============================================================================

/**
 * Start polling the API at configured interval
 */
function startPolling() {
    if (isPolling) {
        console.log('Polling already active');
        return;
    }

    console.log(`Starting API polling every ${API_CONFIG.pollingInterval}ms`);

    // Stop simulation mode if it's running
    // if (window.WTPVisualizer) {
    //     const simBtn = document.getElementById('btn-simulate');
    //     if (simBtn && simBtn.classList.contains('active')) {
    //         window.WTPVisualizer.stopSimulation();
    //         simBtn.classList.remove('active');
    //         simBtn.textContent = 'Simulate Data';
    //     }
    // }

    isPolling = true;

    // First fetch immediately
    fetchAndUpdate();

    // Then poll at interval
    pollingIntervalId = setInterval(fetchAndUpdate, API_CONFIG.pollingInterval);

    updateConnectionIndicator();
}

/**
 * Stop polling the API
 */
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

/**
 * Toggle polling on/off
 */
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

/**
 * Update connection status indicator in UI
 */
function updateConnectionIndicator() {
    const indicator = document.getElementById('api-status-indicator');
    if (!indicator) return;

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

    // Update data source indicator
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
// INITIALIZATION
// ============================================================================

/**
 * Initialize API integration
 */
async function initAPI() {
    console.log('API Integration initialized');

    // Add connection indicator to DOM if it doesn't exist
    createConnectionIndicator();

    // Ensure user is authenticated
    try {
        await ensureAuthenticated();

        // Auto-start polling if configured
        if (API_CONFIG.autoStart) {
            // Wait a bit for the visualizer to load
            setTimeout(() => {
                startPolling();
            }, 1000);
        }
    } catch (error) {
        console.error('Authentication failed:', error);
        console.error('Usage: Add ?auth=YOUR_BEARER_TOKEN to the URL');
        connectionStatus = 'error';
        updateConnectionIndicator();

        // Update data source to show error
        const dataSource = document.getElementById('data-source');
        if (dataSource) {
            dataSource.textContent = 'Data: No Token';
            dataSource.style.color = '#ff5252';
        }
    }
}

/**
 * Create connection status indicator in UI
 */
function createConnectionIndicator() {
    // Check if indicator already exists
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

    // Add toggle button listener
    const toggleBtn = document.getElementById('api-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            togglePolling();
            toggleBtn.textContent = isPolling ? 'Stop' : 'Start';
            toggleBtn.style.background = isPolling ? '#ff5252' : '#4fc3f7';
        });
    }

    // Add logout button listener
    // const logoutBtn = document.getElementById('api-logout-btn');
    // if (logoutBtn) {
    //     logoutBtn.addEventListener('click', async () => {
    //         if (confirm('Are you sure you want to logout? This will clear your stored token. To re-authenticate, reload the page with ?auth=YOUR_TOKEN')) {
    //             stopPolling();
    //             clearToken();
    //             connectionStatus = 'disconnected';
    //             updateConnectionIndicator();

    //             // Update data source indicator
    //             const dataSource = document.getElementById('data-source');
    //             if (dataSource) {
    //                 dataSource.textContent = 'Data: Logged Out';
    //                 dataSource.style.color = '#888';
    //             }

    //             console.log('Logged out. To re-authenticate, reload the page with ?auth=YOUR_TOKEN');
    //         }
    //     });
    // }

    // Update button text on initialization
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
// EXPORTS
// ============================================================================

// Make functions available globally
window.WTPAPI = {
    // Authentication
    login,
    clearToken,
    ensureAuthenticated,
    isAuthenticated: () => isAuthenticated,

    // Data fetching
    startPolling,
    stopPolling,
    togglePolling,
    fetchPlantData,
    transformApiData,

    // Status
    getConnectionStatus: () => connectionStatus,
    getLastFetchTime: () => lastFetchTime,
    isPolling: () => isPolling,

    // Config
    config: API_CONFIG
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAPI);
} else {
    initAPI();
}
