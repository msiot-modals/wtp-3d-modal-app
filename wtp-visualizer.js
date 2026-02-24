/**
 * Water Treatment Plant (WTP) Three.js Visualizer
 *
 * This script loads a .glb model and animates it based on JSON payload data.
 * Expected node naming convention in .glb:
 * - Tanks: RWT, CST, CFT, SCT, CWT, SLT (with _Water suffix for water mesh)
 * - Pumps: CDP, PPS
 * - Mixers: CFT_Mixer, SCT_Scraper
 * - Pipes: Pipe_RWT_CFT, Pipe_CFT_SCT, etc.
 * - Filters: FTR
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    modelPath: 'wtp-model.glb', // Path to your .glb model
    updateInterval: 3000, // Data update interval in ms
    animationSpeed: 0.016, // Animation delta time
    colors: {
        cleanWater: 0x4fc3f7,
        rawWater: 0x8d6e63,
        sludge: 0x5d4037,
        alarm: 0xff5252,
        ok: 0x69f0ae,
        warning: 0xffd740,
        pumpOn: 0x69f0ae,
        pumpOff: 0xff5252,  // Red when OFF
        chemical: 0xab47bc
    },
    tank: {
        minScale: 0.01,
        maxScale: 1.0
    }
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

let scene, camera, renderer, labelRenderer, controls;
let clock = new THREE.Clock();
let model = null;
let labelsVisible = true;

// Component references
const components = {
    tanks: {},
    pumps: {},
    mixers: {},
    pipes: {},
    filters: {},
    labels: {}
};

// Current animation targets (for smooth interpolation)
const animationTargets = {
    levels: {},
    rotations: {},
    flows: {}
};

// Current plant data
let plantData = getDefaultPayload();

// Active alarms
let activeAlarms = [];

// Simulation mode: 'random' or 'manual'
let simulationMode = 'random';

// Manual control values
let manualValues = {
    rwt: { level: 65, ph: 7.2, turbidity: 45 },
    cft: { level: 55, mixer: true },
    sct: { level: 70, sludge: 15, scraper: true },
    cwt: { level: 82, chlorine: 0.8 },
    pumps: { pump1: true, pump2: false, cdp: true }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);

    // Camera setup
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(30, 25, 30);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // CSS2D Label Renderer
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.getElementById('canvas-container').appendChild(labelRenderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 10;
    controls.maxDistance = 100;
    controls.maxPolarAngle = Math.PI / 2;

    // Lighting
    setupLighting();

    // Grid helper (optional, for development)
    const gridHelper = new THREE.GridHelper(100, 50, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Load the model
    loadModel();

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    setupControls();

    // Start animation loop
    animate();
}

function setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    // Main directional light (sun)
    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(50, 50, 25);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 200;
    mainLight.shadow.camera.left = -50;
    mainLight.shadow.camera.right = 50;
    mainLight.shadow.camera.top = 50;
    mainLight.shadow.camera.bottom = -50;
    scene.add(mainLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x4fc3f7, 0.3);
    fillLight.position.set(-30, 20, -30);
    scene.add(fillLight);

    // Hemisphere light for sky/ground ambient
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d1e, 0.3);
    scene.add(hemiLight);
}

// ============================================================================
// MODEL LOADING
// ============================================================================

function loadModel() {
    const loader = new GLTFLoader();

    loader.load(
        CONFIG.modelPath,
        (gltf) => {
            model = gltf.scene;
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
                // Map components by name
                mapComponent(child);
            });

            scene.add(model);

            // Align model: bottom at y=0, centered in X and Z
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const min = box.min;

            // Center horizontally (X and Z), align bottom to y=0
            model.position.set(-center.x, -min.y, -center.z);

            // Make tanks transparent/glassy
            makeTasksGlassy();

            // Create water meshes for tanks
            createWaterMeshes();

            // Create labels for components
            createLabels();

            // Hide loading indicator
            document.getElementById('loading').classList.add('hidden');

            console.log('Model loaded successfully');
            console.log('Mapped components:', components);
            console.log('Pumps found:', {
                CDP: components.pumps.CDP ? 'YES' : 'NO',
                PPS: components.pumps.PPS ? 'YES' : 'NO'
            });
        },
        (progress) => {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
        },
        (error) => {
            console.error('Error loading model:', error);
            document.getElementById('loading').innerHTML = `
                <div style="color: #ff5252;">
                    Error loading model.<br>
                    Make sure 'wtp-model.glb' exists in the project folder.<br>
                    <small>${error.message}</small>
                </div>
            `;
        }
    );
}

// Helper function to add tanks to array
function addToTankArray(key, object) {
    if (!components.tanks[key]) {
        components.tanks[key] = [];
    }
    components.tanks[key].push(object);
}

function mapComponent(object) {
    const name = object.name.toUpperCase();

    // Tanks - store all as arrays for multiple instances support
    if (name.includes('RECBRINE_TANK_TANK')) {
        if (name.includes('WATER')) {
            addToTankArray('RWT_Water', object);
        } else {
            addToTankArray('RWT', object);
        }
    }
    // if (name.includes('REGTANKS_TANK_TANK')) {
    //     if (name.includes('WATER') || name.includes('CHEMICAL')) {
    //         addToTankArray('CST_Water', object);
    //     } else {
    //         addToTankArray('CST', object);
    //     }
    // }
    if (name.includes('WASTEBRINE_TANK')) {
        if (name.includes('WATER')) {
            addToTankArray('CFT_Water', object);
        } else if (name.includes('MIXER')) {
            components.mixers.CFT_Mixer = object;
        } else {
            addToTankArray('CFT', object);
        }
    }
    if (name.includes('REGTANKS_TANK_TANK')) {
        if (name.includes('WATER')) {
            addToTankArray('SCT_Water', object);
        } else if (name.includes('SCRAPER')) {
            components.mixers.SCT_Scraper = object;
        } else if (name.includes('SLUDGE')) {
            addToTankArray('SCT_Sludge', object);
        } else {
            addToTankArray('SCT', object);
        }
    }
    if (name.includes('SATTANK_TANK_TANK')) {
        if (name.includes('WATER')) {
            addToTankArray('CWT_Water', object);
        } else {
            addToTankArray('CWT', object);
        }
    }
    if (name.includes('RESINTANK_TANK')) {
        if (name.includes('WATER') || name.includes('SLUDGE')) {
            addToTankArray('SLT_Water', object);
        } else {
            addToTankArray('SLT', object);
        }
    }

    // Pumps
    if (name.includes('CDP') || name.includes('PUMP2_')) {
        components.pumps.CDP = object;
    }
    if (name.includes('PUMP1_') || name.includes('PPS')) {
        components.pumps.PPS = object;
    }

    // Filters
    if (name.includes('FTR') || name.includes('FILTER')) {
        components.filters.FTR = object;
    }

    // Pipes
    if (name.includes('PIPE')) {
        components.pipes[name] = object;
    }
}

// ============================================================================
// MAKE TANKS GLASSY/TRANSPARENT
// ============================================================================

function makeTasksGlassy() {
    // List of tanks to make glassy
    const glassyTanks = ['RWT', 'CST', 'CFT', 'SCT', 'CWT', 'SLT'];

    glassyTanks.forEach(tankKey => {
        const tankArray = components.tanks[tankKey];
        if (!tankArray) {
            console.warn(`Tank ${tankKey} not found for glass effect`);
            return;
        }

        // Handle array of tanks
        const tanks = Array.isArray(tankArray) ? tankArray : [tankArray];
        tanks.forEach(tank => {
            // Traverse the tank and all its children to find meshes
            tank.traverse((child) => {
                if (child.isMesh) {
                    // Clone the material to avoid affecting other objects
                    if (child.material) {
                        // Handle both single material and array of materials
                        if (Array.isArray(child.material)) {
                            child.material = child.material.map(mat => {
                                const glassMat = mat.clone();
                                applyGlassProperties(glassMat);
                                return glassMat;
                            });
                        } else {
                            child.material = child.material.clone();
                            applyGlassProperties(child.material);
                        }
                    }
                }
            });
        });
    });
}

function applyGlassProperties(material) {
    // Make material transparent like glass
    material.transparent = true;
    material.opacity = 0.4;  // Adjust this value: 0 = invisible, 1 = opaque
    material.depthWrite = false;  // Important for proper transparency rendering

    // Glass-like properties
    if (material.metalness !== undefined) {
        material.metalness = 0.1;
        material.roughness = 0.1;
    }

    // Add slight tint (optional - remove if you want completely clear)
    // material.color.setHex(0xccddff);  // Slight blue tint

    // For MeshPhysicalMaterial, add transmission for realistic glass
    if (material.transmission !== undefined) {
        material.transmission = 0.9;  // High transmission for see-through effect
        material.thickness = 0.5;
        material.ior = 1.5;  // Index of refraction (glass is ~1.5)
    }

    material.needsUpdate = true;
}

// ============================================================================
// WATER MESH CREATION
// ============================================================================

function createWaterMeshes() {
    // Define tank configurations
    // Each tank identified by key, not by shape type
    const tankConfigs = [
        { key: 'RWT', color: CONFIG.colors.rawWater, rotation: [Math.PI/2, 0, 0] },
        { key: 'CST', color: CONFIG.colors.chemical },
        { key: 'CFT', color: CONFIG.colors.cleanWater },
        { key: 'SCT', color: CONFIG.colors.cleanWater, rotation: [Math.PI/2, 0, 0] },
        { key: 'CWT', color: CONFIG.colors.cleanWater, rotation: [Math.PI/2, 0, 0] },
        { key: 'SLT', color: CONFIG.colors.sludge, rotation: [Math.PI/2, 0, 0] }
    ];

    tankConfigs.forEach(({ key, width, depth, color, rotation }) => {
        const tankArray = components.tanks[key];
        if (!tankArray) {
            console.warn(`Tank ${key} not found, skipping water mesh creation`);
            return;
        }

        // Handle array of tanks
        const tanks = Array.isArray(tankArray) ? tankArray : [tankArray];
        tanks.forEach((tank, tankIndex) => {
            // Find the tank's geometry in its LOCAL coordinate system
        let localBBox = null;
        let tankHeight = 0;
        let radius = 0;

        tank.traverse((child) => {
            if (child.isMesh && child.geometry) {
                // Compute bounding box in the geometry's own space
                child.geometry.computeBoundingBox();
                const geomBox = child.geometry.boundingBox;

                if (geomBox) {
                    // Transform to tank's local space
                    const box = geomBox.clone();

                    // If this is the tank mesh itself (not a child), use directly
                    if (child === tank) {
                        localBBox = box;
                    } else {
                        // Transform child's bounding box to tank's local space
                        const matrix = child.matrix.clone();
                        box.applyMatrix4(matrix);

                        if (!localBBox) {
                            localBBox = box;
                        } else {
                            localBBox.union(box);
                        }
                    }
                }
            }
        });

        // Fallback to world bounding box if no geometry found
        if (!localBBox) {
            const worldBox = new THREE.Box3().setFromObject(tank);
            tankHeight = worldBox.max.z - worldBox.min.z;
            radius = (worldBox.max.x - worldBox.min.x) / 2 - 4;
            localBBox = new THREE.Box3(
                new THREE.Vector3(-radius, 0, -radius),
                new THREE.Vector3(radius, tankHeight, radius)
            );
        } else {
            tankHeight = localBBox.max.z - localBBox.min.z;
            const width = localBBox.max.x - localBBox.min.x;
            radius = width / 2 - 4;
        }

        // Get the center of the geometry in local coordinates
        const localCenter = new THREE.Vector3();
        localBBox.getCenter(localCenter);

        // Create water geometry based on TANK KEY
        let waterGeometry;

        if (key === 'SLT') {
            // SLT tank: Special cone-cylinder water
            // SPECIAL CASE: Inverted cone (point at bottom) fills first, then cylinder
            // Water fills from point upward with increasing radius
            const waterRadius = radius;
            const coneH = radius - 5;
            const cylinderH = tankHeight - radius - 15;
            const totalHeight = tankHeight;

            // Create INVERTED CONE water mesh (point at bottom, wide at top)
            // This will be dynamically updated to show correct radius at water level
            const coneMaterial = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.3,
                transparent: true,
                opacity: 0.7,
                metalness: 0.2,
                roughness: 0.4,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            // Create initial cone geometry with small but visible size
            const initialHeight = coneH * 0.1;  // Start at 10% for visibility
            const initialRadius = waterRadius * 0.1;
            const initialGeometry = new THREE.CylinderGeometry(
                initialRadius,  // Top radius
                0.1,           // Bottom radius (small point)
                initialHeight, // Height
                64             // Segments
            );
            const coneWaterMesh = new THREE.Mesh(initialGeometry, coneMaterial);

            // Store cone info - including max radius for calculations
            coneWaterMesh.userData.tankHeight = coneH;
            coneWaterMesh.userData.maxRadius = waterRadius;  // Max radius at full height
            coneWaterMesh.userData.localCenter = localCenter.clone();
            coneWaterMesh.userData.bottomY = localBBox.min.z;
            coneWaterMesh.userData.isCone = true;
            coneWaterMesh.userData.needsGeometryUpdate = true;  // Flag for dynamic updates

            // Position cone - start from bottom
            coneWaterMesh.position.x = localCenter.x;
            coneWaterMesh.position.y = localCenter.y;
            coneWaterMesh.position.z = localBBox.min.z + initialHeight / 2;

            if (rotation) {
                coneWaterMesh.rotation.set(rotation[0], rotation[1], rotation[2]);
            }

            coneWaterMesh.visible = true;
            coneWaterMesh.castShadow = true;
            coneWaterMesh.receiveShadow = true;

            tank.add(coneWaterMesh);
            components.tanks[`${key}_Water_Cone`] = coneWaterMesh;

            // Create CYLINDER water mesh
            const cylinderGeometry = new THREE.CylinderGeometry(waterRadius, waterRadius, cylinderH, 64);
            const cylinderMaterial = coneMaterial.clone();
            const cylinderWaterMesh = new THREE.Mesh(cylinderGeometry, cylinderMaterial);

            // Store cylinder info
            cylinderWaterMesh.userData.tankHeight = cylinderH;
            cylinderWaterMesh.userData.localCenter = localCenter.clone();
            cylinderWaterMesh.userData.bottomY = localBBox.min.z + coneH;
            cylinderWaterMesh.userData.isCylinder = true;
            cylinderWaterMesh.userData.coneHeight = coneH;

            // Position cylinder ON TOP of cone
            cylinderWaterMesh.position.x = localCenter.x;
            cylinderWaterMesh.position.y = localCenter.y;
            cylinderWaterMesh.scale.y = 0;  // Start invisible
            cylinderWaterMesh.position.z = coneH;  // Start at top of cone

            if (rotation) {
                cylinderWaterMesh.rotation.set(rotation[0], rotation[1], rotation[2]);
            }

            cylinderWaterMesh.visible = false;  // Hidden until cone is full
            cylinderWaterMesh.castShadow = true;
            cylinderWaterMesh.receiveShadow = true;

            tank.add(cylinderWaterMesh);
            components.tanks[`${key}_Water_Cylinder`] = cylinderWaterMesh;

            // Skip default water mesh creation for SLT
            return;

        } else if (key === 'CFT' || key === 'RWT' || key === 'SCT' || key === 'CWT') {
            // CFT tank: Handle multiple water meshes as array
            const existingWaterArray = components.tanks[`${key}_Water`];
            if (existingWaterArray && Array.isArray(existingWaterArray)) {
                existingWaterArray.forEach((existingWater, index) => {
                    // Store the original scale Y as reference
                    existingWater.userData.originalScaleY = existingWater.scale.y;

                    // Calculate mesh height and bottom position
                    const waterBox = new THREE.Box3().setFromObject(existingWater);
                    const meshHeight = waterBox.max.z - waterBox.min.z;
                    const bottomZ = waterBox.min.z;

                    // Store for animation
                    existingWater.userData.meshHeight = tankHeight;
                    existingWater.userData.bottomZ = bottomZ;
                    existingWater.userData.originalPosZ = existingWater.position.z;
                    existingWater.userData.tankIndex = index;  // Store index for identification

                    // Apply water material
                    const waterMaterial = new THREE.MeshStandardMaterial({
                        color: color,
                        emissive: color,
                        emissiveIntensity: 0.3,
                        transparent: true,
                        opacity: 0.7,
                        metalness: 0.2,
                        roughness: 0.4,
                        side: THREE.DoubleSide,
                        depthWrite: false
                    });

                    if (existingWater.material) {
                        existingWater.material.dispose();
                    }
                    existingWater.material = waterMaterial;
                    existingWater.visible = true;
                });
                return;
            }
            return;

        } else {
            // Default: Cylindrical water (RWT, CST, CFT, CWT, etc.)
            waterGeometry = new THREE.CylinderGeometry(radius, radius, tankHeight, 64);
        }

        // Create water material
        const waterMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.7,
            metalness: 0.2,
            roughness: 0.4,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        // Create water mesh
        const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);

        // Store tank info for animation
        waterMesh.userData.tankHeight = tankHeight;
        waterMesh.userData.localCenter = localCenter.clone();
        waterMesh.userData.bottomY = localBBox.min.z;

        // Position water in tank's LOCAL coordinate system
        // Center in X and Z
        waterMesh.position.x = localCenter.x;
        waterMesh.position.y = localCenter.y;

        // Apply rotation if specified in config
        if (rotation) {
            waterMesh.rotation.set(rotation[0], rotation[1], rotation[2]);
        }
        // Or manually rotate here (values in radians):
        // waterMesh.rotation.x = Math.PI / 2;  // Rotate 90° around X axis
        // waterMesh.rotation.y = Math.PI / 4;  // Rotate 45° around Y axis
        // waterMesh.rotation.z = Math.PI;      // Rotate 180° around Z axis

        // Initially set scale to minimum (tank empty)
        waterMesh.scale.y = CONFIG.tank.minScale;

        waterMesh.position.z = tankHeight * waterMesh.scale.y / 2;

        // Y position: bottom + half of scaled height
        // waterMesh.position.y = localBBox.min.y - (tankHeight * waterMesh.scale.y) / 2;

        // Make visible
        waterMesh.visible = true;
        waterMesh.castShadow = true;
        waterMesh.receiveShadow = true;

        // Add water mesh to tank (in tank's local space)
        tank.add(waterMesh);

        // Store reference in array
        if (!components.tanks[`${key}_Water`]) {
            components.tanks[`${key}_Water`] = [];
        }
        components.tanks[`${key}_Water`].push(waterMesh);
        });  // Close tanks.forEach
    });  // Close tankConfigs.forEach
}

// ============================================================================
// LABELS
// ============================================================================

function createLabels() {
    // Create labels for main tanks
    const tankLabels = [
        { key: 'RWT', text: 'Raw Water Tank', dataKey: 'rwt' },
        { key: 'CST', text: 'Chemical Storage', dataKey: 'cst' },
        { key: 'CFT', text: 'Coagulation Tank', dataKey: 'cft' },
        { key: 'SCT', text: 'Sedimentation Tank', dataKey: 'sct' },
        { key: 'CWT', text: 'Clean Water Tank', dataKey: 'cwt' },
        { key: 'SLT', text: 'Sludge Tank', dataKey: 'slt' }
    ];

    tankLabels.forEach(({ key, text, dataKey }) => {
        const tankArray = components.tanks[key];
        if (tankArray) {
            const tanks = Array.isArray(tankArray) ? tankArray : [tankArray];
            tanks.forEach((tank, index) => {
                const labelText = tanks.length > 1 ? `${text} ${index + 1}` : text;
                const labelIndex = tanks.length > 1 ? index : null;
                const label = createLabel(labelText, dataKey, labelIndex);
                tank.add(label);
                const labelKey = tanks.length > 1 ? `${key}_${index}` : key;
                components.labels[labelKey] = label;
            });
        }
    });

    // Create labels for pumps
    const pumpLabels = [
        { key: 'CDP', text: 'Chemical Dosing Pump', dataKey: 'cdp' },
        { key: 'PPS', text: 'Main Pump', dataKey: 'pps' }
    ];

    pumpLabels.forEach(({ key, text, dataKey }) => {
        const pump = components.pumps[key];
        if (pump) {
            const label = createLabel(text, dataKey, null, 'small');
            pump.add(label);
            components.labels[key] = label;
        }
    });
}

function createLabel(text, dataKey, index = null, size = 'normal') {
    const div = document.createElement('div');
    div.className = 'label-3d';
    const labelId = index !== null ? `label-${dataKey}-${index}` : `label-${dataKey}`;

    // Size configurations
    const sizes = {
        small: { fontSize: '9px', padding: '3px 6px', titleSize: '9px' },
        normal: { fontSize: '11px', padding: '5px 10px', titleSize: '11px' }
    };
    const config = sizes[size] || sizes.normal;

    div.innerHTML = `
        <div style="
            background: rgba(0,0,0,0.3);
            padding: ${config.padding};
            border-radius: 4px;
            font-size: ${config.fontSize};
            white-space: nowrap;
            border-left: 3px solid #4fc3f7;
        ">
            <div style="color: #4fc3f7; font-weight: bold; font-size: ${config.titleSize};">${text}</div>
            <div style="color: #fff;" id="${labelId}">--</div>
        </div>
    `;

    const label = new CSS2DObject(div);
    label.position.set(0, 5, 0);
    return label;
}

function updateLabels() {
    // Update single tank labels
    const singleTankUpdates = {
        'rwt': plantData.RWT?.Level,
        'cst': plantData.CST?.Level,
        'cft': plantData.CFT?.Level,
        'slt': plantData.SLT?.Level
    };

    Object.entries(singleTankUpdates).forEach(([key, level]) => {
        const el = document.getElementById(`label-${key}`);
        if (el) el.textContent = `Level: ${level?.toFixed(1) || '--'}%`;
    });

    // Update SCT labels (array of 2 tanks)
    if (Array.isArray(plantData.SCT)) {
        plantData.SCT.forEach((tankData, index) => {
            const el = document.getElementById(`label-sct-${index}`);
            if (el) el.textContent = `Level: ${tankData?.Level?.toFixed(1) || '--'}%`;
        });
    }

    // Update CWT labels (array of 2 tanks)
    if (Array.isArray(plantData.CWT)) {
        plantData.CWT.forEach((tankData, index) => {
            const el = document.getElementById(`label-cwt-${index}`);
            if (el) el.textContent = `Level: ${tankData?.Level?.toFixed(1) || '--'}%`;
        });
    }

    // Update pump labels
    const cdpEl = document.getElementById('label-cdp');
    if (cdpEl) {
        const cdpStatus = plantData.CDP?.Status ? 'ON' : 'OFF';
        cdpEl.textContent = `Status: ${cdpStatus}`;
        cdpEl.style.color = plantData.CDP?.Status ? '#69f0ae' : '#ff5252';
    }

    const ppsEl = document.getElementById('label-pps');
    if (ppsEl) {
        const ppsStatus = plantData.PPS?.Status ? 'ON' : 'OFF';
        ppsEl.textContent = `Status: ${ppsStatus}`;
        ppsEl.style.color = plantData.PPS?.Status ? '#69f0ae' : '#ff5252';
    }
}

function toggleLabels() {
    labelsVisible = !labelsVisible;
    Object.values(components.labels).forEach(label => {
        label.visible = labelsVisible;
    });
}

// ============================================================================
// ANIMATIONS
// ============================================================================

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.1); // Clamp delta to max 100ms to prevent huge jumps when tab is inactive

    // Update controls
    controls.update();

    // Update animations
    updateTankLevels(delta);
    updateMixers(delta);
    updatePumps(delta);
    updatePipeFlows(delta);
    updateAlarmEffects(delta);

    // Render
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

function updateTankLevels(delta) {
    const lerpFactor = 2 * delta; // Smooth interpolation

    // Update each tank water level
    const tankMappings = [
        { key: 'RWT', water: 'RWT_Water', data: plantData.RWT?.Level },
        { key: 'CST', water: 'CST_Water', data: plantData.CST?.Level },
        { key: 'CFT', water: 'CFT_Water', data: plantData.CFT?.Level },
        { key: 'SCT', water: 'SCT_Water', data: plantData.SCT },  // Array of tank data
        { key: 'CWT', water: 'CWT_Water', data: plantData.CWT },  // Array of tank data
        { key: 'SLT', water: 'SLT_Water', data: plantData.SLT?.Level }
    ];

    tankMappings.forEach(({ key, water, data }) => {
        // Handle tanks with multiple instances (SCT, CWT)
        if ((key === 'SCT' || key === 'CWT') && Array.isArray(data)) {
            const waterMeshArray = components.tanks[water];
            if (waterMeshArray && Array.isArray(waterMeshArray)) {
                data.forEach((tankData, index) => {
                    const waterMesh = waterMeshArray[index];
                    if (waterMesh && tankData?.Level !== undefined) {
                        const levelData = tankData.Level;
                        const originalScaleY = waterMesh.userData.originalScaleY || 1.0;
                        const levelScale = CONFIG.tank.minScale + (levelData / 100) * (CONFIG.tank.maxScale - CONFIG.tank.minScale);
                        const targetScale = originalScaleY * levelScale;

                        const animKey = `${water}_${index}`;
                        if (animationTargets.levels[animKey] === undefined) {
                            animationTargets.levels[animKey] = waterMesh.scale.y;
                        }

                        animationTargets.levels[animKey] = THREE.MathUtils.lerp(
                            animationTargets.levels[animKey],
                            targetScale,
                            lerpFactor
                        );

                        waterMesh.scale.y = animationTargets.levels[animKey];
                        waterMesh.visible = levelData > 1;
                    }
                });
            }
            return;  // Skip normal processing for these tanks
        }

        // Normal processing for single-value data
        // Handle tank-specific water animations
        if (key === 'SLT') {
            // SLT tank: Cone-cylinder special animation
            const coneMesh = components.tanks[water + '_Cone'];
            const cylinderMesh = components.tanks[water + '_Cylinder'];

            if (coneMesh && cylinderMesh && data !== undefined) {
                const levelPercent = data;  // 0-100

                // Assume cone is 33% of total height, cylinder is 67%
                const conePercent = 25;
                const cylinderPercent = 75;

                // Initialize animation targets if not set
                if (animationTargets.levels[water + '_Cone'] === undefined) {
                    animationTargets.levels[water + '_Cone'] = 0;
                }
                if (animationTargets.levels[water + '_Cylinder'] === undefined) {
                    animationTargets.levels[water + '_Cylinder'] = 0;
                }

                // Calculate fill levels
                if (levelPercent <= conePercent) {
                    // Only fill cone (0-25%)
                    const coneFillPercent = (levelPercent / conePercent);  // 0.0 to 1.0

                    // STEP 1: Animate cylinder DOWN to 0 FIRST
                    animationTargets.levels[water + '_Cylinder'] = THREE.MathUtils.lerp(
                        animationTargets.levels[water + '_Cylinder'],
                        0,
                        lerpFactor * 2  // Faster animation
                    );

                    const cylinderFillLevel = animationTargets.levels[water + '_Cylinder'];

                    // STEP 2: After cylinder is completely gone (< 0.01), start reducing cone
                    if (cylinderFillLevel < 0.01) {
                        // Cylinder is GONE, now animate cone to target
                        animationTargets.levels[water + '_Cone'] = THREE.MathUtils.lerp(
                            animationTargets.levels[water + '_Cone'],
                            coneFillPercent,
                            lerpFactor
                        );
                    } else {
                        // Keep cone LOCKED at full (1.0) while cylinder is disappearing
                        // Don't lerp - just stay at 1.0
                        if (animationTargets.levels[water + '_Cone'] < 0.99) {
                            animationTargets.levels[water + '_Cone'] = THREE.MathUtils.lerp(
                                animationTargets.levels[water + '_Cone'],
                                1.0,
                                lerpFactor
                            );
                        } else {
                            animationTargets.levels[water + '_Cone'] = 1.0;
                        }
                    }

                    const fillLevel = animationTargets.levels[water + '_Cone'];

                    // Update cone geometry dynamically based on fill level
                    if (coneMesh.userData.needsGeometryUpdate && coneMesh.userData.maxRadius) {
                        const maxRadius = coneMesh.userData.maxRadius;  // Get from stored userData
                        const maxHeight = coneMesh.userData.tankHeight;

                        // Calculate current height and radius based on fill level
                        const currentHeight = Math.max(0.5, fillLevel * maxHeight);
                        const currentTopRadius = Math.max(0.1, fillLevel * maxRadius);

                        // Create new geometry with correct proportions
                        const newGeometry = new THREE.CylinderGeometry(
                            currentTopRadius,  // Top radius (grows with height)
                            0.1,              // Bottom radius (small point)
                            currentHeight,    // Height
                            64                // Segments
                        );

                        // Dispose old geometry and update
                        coneMesh.geometry.dispose();
                        coneMesh.geometry = newGeometry;

                        // Position: center at half the current height from bottom
                        const bottomY = coneMesh.userData.bottomY;
                        coneMesh.position.z = bottomY + currentHeight / 2;
                    }

                    coneMesh.visible = fillLevel > 0.001;

                    // Keep cylinder visible during transition if it's animating down
                    cylinderMesh.visible = cylinderFillLevel > 0.001;
                    if (cylinderMesh.visible) {
                        cylinderMesh.scale.y = cylinderFillLevel;
                        if (cylinderMesh.userData.tankHeight && cylinderMesh.userData.coneHeight !== undefined) {
                            const tankHeight = cylinderMesh.userData.tankHeight;
                            const coneH = cylinderMesh.userData.coneHeight;
                            cylinderMesh.position.z = (coneH - coneMesh.position.z + 6) + (tankHeight * cylinderMesh.scale.y) / 2;
                        }
                    }

                } else {
                    // Above 25%: Fill cylinder (25-100%)
                    coneMesh.visible = true;

                    // STEP 1: Animate cone UP to full size (1.0) FIRST
                    animationTargets.levels[water + '_Cone'] = THREE.MathUtils.lerp(
                        animationTargets.levels[water + '_Cone'],
                        1.0,  // Target is full
                        lerpFactor
                    );

                    const coneFillLevel = animationTargets.levels[water + '_Cone'];

                    // STEP 2: After cone is at 100% (> 0.99), start filling cylinder
                    const cylinderFillPercent = ((levelPercent - conePercent) / cylinderPercent);

                    if (coneFillLevel > 0.99) {
                        // Cone is FULL, now start filling cylinder
                        animationTargets.levels[water + '_Cylinder'] = THREE.MathUtils.lerp(
                            animationTargets.levels[water + '_Cylinder'],
                            cylinderFillPercent,
                            lerpFactor
                        );
                    } else {
                        // Cone still filling, keep cylinder at 0
                        animationTargets.levels[water + '_Cylinder'] = 0;
                    }

                    // Update cone geometry to current fill level (animating to full)
                    if (coneMesh.userData.needsGeometryUpdate && coneMesh.userData.maxRadius) {
                        const maxRadius = coneMesh.userData.maxRadius;
                        const maxHeight = coneMesh.userData.tankHeight;

                        // Use animated fill level for smooth transition
                        const currentHeight = coneFillLevel * maxHeight;
                        const currentTopRadius = coneFillLevel * maxRadius;

                        // Create cone geometry at current fill level
                        const coneGeometry = new THREE.CylinderGeometry(
                            currentTopRadius,
                            0.1,
                            currentHeight,
                            64
                        );

                        coneMesh.geometry.dispose();
                        coneMesh.geometry = coneGeometry;

                        // Position at current height
                        const bottomY = coneMesh.userData.bottomY;
                        coneMesh.position.z = bottomY + currentHeight / 2;
                    }

                    // Update cylinder scale and position using animation target
                    const cylinderFillLevel = animationTargets.levels[water + '_Cylinder'];
                    cylinderMesh.scale.y = cylinderFillLevel;

                    // Update cylinder position
                    if (cylinderMesh.userData.tankHeight && cylinderMesh.userData.coneHeight !== undefined) {
                        const tankHeight = cylinderMesh.userData.tankHeight;
                        const coneH = cylinderMesh.userData.coneHeight;
                        cylinderMesh.position.z = (coneH - coneMesh.position.z + 6) + (tankHeight * cylinderFillLevel) / 2;
                    }

                    // Show cylinder only if it has started filling (cone is full)
                    cylinderMesh.visible = cylinderFillLevel > 0.001;
                }
            }
            return;  // Skip normal processing

        } else if (key === 'CFT' || key === 'RWT' || key === 'SCT' || key === 'CWT') {
            // CFT tank: Handle multiple water meshes as array
            const waterMeshArray = components.tanks[water];
            if (waterMeshArray && Array.isArray(waterMeshArray) && data !== undefined) {
                waterMeshArray.forEach((waterMesh, index) => {
                    // Get original scale as reference
                    const originalScaleY = waterMesh.userData.originalScaleY || 1.0;

                    // Calculate target scale based on level data (0-100%)
                    const levelScale = CONFIG.tank.minScale +
                        (data / 100) * (CONFIG.tank.maxScale - CONFIG.tank.minScale);

                    // Target scale = original scale * level percentage
                    const targetScale = originalScaleY * levelScale;

                    // Initialize if not set (unique key per tank instance)
                    const animKey = `${water}_${index}`;
                    if (animationTargets.levels[animKey] === undefined) {
                        animationTargets.levels[animKey] = waterMesh.scale.y;
                    }

                    // Smooth interpolation
                    animationTargets.levels[animKey] = THREE.MathUtils.lerp(
                        animationTargets.levels[animKey],
                        targetScale,
                        lerpFactor
                    );

                    // Update Y scale
                    waterMesh.scale.y = animationTargets.levels[animKey];
                    waterMesh.visible = data > 1;
                });
            }
            return;
        }

        // Normal tank processing - handle arrays
        const waterMeshArray = components.tanks[water];
        if (waterMeshArray && data !== undefined) {
            const waterMeshes = Array.isArray(waterMeshArray) ? waterMeshArray : [waterMeshArray];

            waterMeshes.forEach((waterMesh, index) => {
                const targetScale = CONFIG.tank.minScale +
                    (data / 100) * (CONFIG.tank.maxScale - CONFIG.tank.minScale);

                // Initialize if not set (unique key per tank instance)
                const animKey = waterMeshes.length > 1 ? `${water}_${index}` : water;
                if (animationTargets.levels[animKey] === undefined) {
                    animationTargets.levels[animKey] = waterMesh.scale.y;
                }

                // Smooth interpolation
                animationTargets.levels[animKey] = THREE.MathUtils.lerp(
                    animationTargets.levels[animKey],
                    targetScale,
                    lerpFactor
                );

                // Update scale
                waterMesh.scale.y = animationTargets.levels[animKey];

                // Update Y position in tank's local coordinate system
                // Position = bottom Y + half of scaled height
                if (waterMesh.userData.tankHeight !== undefined && waterMesh.userData.bottomY !== undefined) {
                    const tankHeight = waterMesh.userData.tankHeight;
                    const bottomY = waterMesh.userData.bottomY;
                    waterMesh.position.z = bottomY + (tankHeight * waterMesh.scale.y) / 2;
                }
            });
        }
    });

    // Update water colors based on turbidity/type
    updateWaterColors();
}

function updateWaterColors() {
    // Raw water tank - brown based on turbidity
    const rwtWater = components.tanks.RWT_Water;
    if (rwtWater && rwtWater.material) {
        const turbidity = plantData.RWT?.Turbidity || 0;
        const color = new THREE.Color().lerpColors(
            new THREE.Color(CONFIG.colors.cleanWater),
            new THREE.Color(CONFIG.colors.rawWater),
            Math.min(turbidity / 100, 1)
        );
        rwtWater.material.color = color;
        rwtWater.material.opacity = 0.7;
        rwtWater.material.transparent = true;
    }

    // Clean water tank - blue
    const cwtWater = components.tanks.CWT_Water;
    if (cwtWater && cwtWater.material) {
        cwtWater.material.color = new THREE.Color(CONFIG.colors.cleanWater);
        cwtWater.material.opacity = 0.7;
        cwtWater.material.transparent = true;
    }

    // Sludge tank - brown
    const sltWater = components.tanks.SLT_Water;
    if (sltWater && sltWater.material) {
        sltWater.material.color = new THREE.Color(CONFIG.colors.sludge);
        sltWater.material.opacity = 0.8;
        sltWater.material.transparent = true;
    }
}

function updateMixers(delta) {
    // CFT Mixer rotation
    const cftMixer = components.mixers.CFT_Mixer;
    if (cftMixer && plantData.CFT?.Mixer_Status) {
        cftMixer.rotation.y += delta * 2; // Rotate when mixer is on
    }

    // SCT Scraper rotation
    const sctScraper = components.mixers.SCT_Scraper;
    if (sctScraper && plantData.SCT?.Scraper_Status) {
        sctScraper.rotation.y += delta * 0.5; // Slower rotation for scraper
    }
}

function updatePumps(delta) {
    const time = clock.getElapsedTime();

    // Chemical Dosing Pump (PUMP2)
    const cdp = components.pumps.CDP;
    if (cdp) {
        const isOn = plantData.CDP?.Status;
        const hasFault = plantData.CDP?.Fault;

        // Debug: Log pump status (only occasionally to avoid spam)
        if (Math.random() < 0.01) {
            console.log('CDP Status:', { isOn, hasFault, hasComponent: !!cdp });
        }

        setPumpColor(cdp, isOn, hasFault, time);

        // Slight vibration when running
        if (isOn && !hasFault) {
            if (!cdp.userData.originalY) {
                cdp.userData.originalY = cdp.position.y;
            }
            cdp.position.y = cdp.userData.originalY + Math.sin(time * 30) * 0.02;
        } else {
            // Reset to original position when off or fault
            if (cdp.userData.originalY !== undefined) {
                cdp.position.y = cdp.userData.originalY;
            }
        }
    }

    // Main Pump Station (PUMP1)
    const pps = components.pumps.PPS;
    if (pps) {
        const isOn = plantData.PPS?.Status;
        const hasFault = plantData.PPS?.Fault;

        // Debug: Log pump status (only occasionally to avoid spam)
        if (Math.random() < 0.01) {
            console.log('PPS Status:', { isOn, hasFault, hasComponent: !!pps });
        }

        setPumpColor(pps, isOn, hasFault, time);

        // Slight vibration when running
        if (isOn && !hasFault) {
            if (!pps.userData.originalY) {
                pps.userData.originalY = pps.position.y;
            }
            pps.position.y = pps.userData.originalY + Math.sin(time * 30) * 0.02;
        } else {
            // Reset to original position when off or fault
            if (pps.userData.originalY !== undefined) {
                pps.position.y = pps.userData.originalY;
            }
        }
    }
}

function setPumpColor(pump, isOn, hasFault, time) {
    if (!pump) return;

    // Traverse pump to apply color only to pump meshes (clone materials to avoid affecting other objects)
    pump.traverse((child) => {
        if (child.isMesh && child.material) {
            // Clone materials on first use so shared materials on other objects are not affected
            if (!child.userData.pumpMaterialCloned) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => mat.clone());
                } else {
                    child.material = child.material.clone();
                }
                child.userData.pumpMaterialCloned = true;
            }

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (mat.emissive !== undefined) {
                    // Priority: Fault > On > Off
                    if (hasFault) {
                        // FAULT: Blinking red alarm
                        mat.emissive = new THREE.Color(CONFIG.colors.alarm);
                        mat.emissiveIntensity = Math.sin(time * 5) > 0 ? 0.8 : 0.2;
                    } else if (isOn) {
                        // ON: Pulsing green glow
                        mat.emissive = new THREE.Color(CONFIG.colors.pumpOn);
                        mat.emissiveIntensity = 0.3 + Math.sin(time * 5) * 0.1;
                    } else {
                        // OFF: Solid red
                        mat.emissive = new THREE.Color(CONFIG.colors.pumpOff);
                        mat.emissiveIntensity = 0.5;
                    }
                }
            });
        }
    });
}

function updatePipeFlows(delta) {
    // Animate pipe materials to show flow
    const flowRate = plantData.PPS?.Flow_Rate || 0;
    const time = clock.getElapsedTime();

    Object.values(components.pipes).forEach(pipe => {
        if (pipe.material && flowRate > 0) {
            // Clone material on first use so shared materials on other objects are not affected
            if (!pipe.userData.pipeMaterialCloned) {
                pipe.material = pipe.material.clone();
                pipe.userData.pipeMaterialCloned = true;
            }
            // Create flowing effect using texture offset or color pulse
            if (pipe.material.map) {
                pipe.material.map.offset.x += delta * flowRate * 0.01;
            }
            // Pulse effect for pipes
            pipe.material.emissive = new THREE.Color(CONFIG.colors.cleanWater);
            pipe.material.emissiveIntensity = 0.1 + Math.sin(time * 3) * 0.05;
        }
    });
}

function updateAlarmEffects(delta) {
    const time = clock.getElapsedTime();
    const alarmPulse = Math.sin(time * 5) > 0;

    // Check for alarms and update visual effects
    activeAlarms = [];

    // RWT alarms - use API alarm flags
    if (plantData.RWT) {
        if (plantData.RWT.High_Level_Alarm) {
            activeAlarms.push('RWT High Level');
            pulseComponent(components.tanks.RWT, true);  // Solid red for high
        } else if (plantData.RWT.Low_Level_Alarm) {
            activeAlarms.push('RWT Low Level');
            pulseComponent(components.tanks.RWT, alarmPulse);  // Blinking for low
        } else {
            pulseComponent(components.tanks.RWT, false);  // Normal - reset color
        }
    }

    // CST alarms - use API alarm flags
    if (plantData.CST) {
        if (plantData.CST.Low_Level_Alarm) {
            activeAlarms.push('CST Low Level');
            pulseComponent(components.tanks.CST, alarmPulse);  // Blinking for low
        } else {
            pulseComponent(components.tanks.CST, false);  // Normal - reset color
        }
    }

    // CFT alarms - no alarm flags in API, so skip visual alarms
    pulseComponent(components.tanks.CFT, false);

    // SCT alarms - no alarm flags in API, so skip visual alarms
    if (Array.isArray(plantData.SCT)) {
        plantData.SCT.forEach((tankData, index) => {
            const tankArray = components.tanks.SCT;
            if (tankArray && tankArray[index]) {
                pulseComponent([tankArray[index]], false);
            }
        });
    }

    // CWT alarms (array of 2 tanks) - use API alarm flags
    if (Array.isArray(plantData.CWT)) {
        plantData.CWT.forEach((tankData, index) => {
            const tankArray = components.tanks.CWT;
            if (tankData && tankArray && tankArray[index]) {
                if (tankData.High_Level_Alarm) {
                    activeAlarms.push(`CWT ${index + 1} High Level`);
                    pulseComponent([tankArray[index]], true);  // Solid red for high
                } else if (tankData.Low_Level_Alarm) {
                    activeAlarms.push(`CWT ${index + 1} Low Level`);
                    pulseComponent([tankArray[index]], alarmPulse);  // Blinking for low
                } else {
                    pulseComponent([tankArray[index]], false);  // Normal - reset color
                }
            }
        });
    }

    // SLT alarms - no alarm flags in API, so skip visual alarms
    pulseComponent(components.tanks.SLT, false);

    // Pump faults - use API fault flags
    // NOTE: Don't override pump colors here - let updatePumps() handle normal on/off colors
    // Only add to alarm list, visual effects handled by updatePumps()
    if (plantData.CDP?.Fault) {
        activeAlarms.push('CDP Fault');
    }

    if (plantData.PPS?.Fault) {
        activeAlarms.push('PPS Fault');
    }

    // Update alarm panel
    updateAlarmPanel();
}

function pulseComponent(component, pulse) {
    if (!component) return;

    // Handle arrays of components (for tanks with multiple instances)
    if (Array.isArray(component)) {
        component.forEach(comp => pulseSingleComponent(comp, pulse));
    } else {
        pulseSingleComponent(component, pulse);
    }
}

function pulseSingleComponent(component, pulse) {
    if (component) {
        // Traverse the component to find all meshes
        component.traverse((child) => {
            if (child.isMesh && child.material) {
                // Handle both single material and array of materials
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat.emissive !== undefined) {
                        mat.emissive = new THREE.Color(pulse ? CONFIG.colors.alarm : 0x000000);
                        mat.emissiveIntensity = pulse ? 0.5 : 0;
                    }
                });
            }
        });
    }
}

function updateAlarmPanel() {
    const panel = document.getElementById('alarm-panel');
    const list = document.getElementById('alarm-list');

    if (activeAlarms.length > 0) {
        panel.classList.add('active');
        list.innerHTML = activeAlarms.map(a => `<div>- ${a}</div>`).join('');
    } else {
        panel.classList.remove('active');
    }
}

// ============================================================================
// DATA HANDLING
// ============================================================================

function getDefaultPayload() {
    return {
        RWT: {
            Level: 65,
            High_Level_Alarm: false,
            Low_Level_Alarm: false,
            Inflow_Rate: 120,
            Outflow_Rate: 115,
            pH: 7.2,
            Turbidity: 45
        },
        CDP: {
            Status: true,
            Mode: 'AUTO',
            Dosing_Rate: 5.5,
            Total_Chemical_Used: 1250,
            Pressure: 2.5,
            Fault: false
        },
        CST: {
            Level: 78,
            Low_Level_Alarm: false
        },
        CFT: {
            Level: 55,
            Mixer_Status: true,
            pH: 6.8,
            Turbidity: 25,
            Dosing_Rate: 3.2
        },
        // SCT has 2 tanks
        SCT: [
            { Level: 70, Sludge_Level: 15, Turbidity_Outlet: 8, Scraper_Status: true },
            { Level: 68, Sludge_Level: 12, Turbidity_Outlet: 7, Scraper_Status: true }
        ],
        FTR: {
            Differential_Pressure: 0.8,
            Flow_Rate: 95,
            Backwash_Status: false
        },
        // CWT has 2 tanks
        CWT: [
            { Level: 82, pH: 7.0, Turbidity: 0.5, Residual_Chlorine: 0.8},
            { Level: 80, pH: 7.1, Turbidity: 0.4, Residual_Chlorine: 0.7}
        ],
        SLT: {
            Level: 35,
            Pump_Status: false
        },
        PPS: {
            Status: true,
            Mode: 'AUTO',
            Flow_Rate: 110,
            Outlet_Pressure: 3.2,
            Fault: false
        },
        PLT: {
            Total_Inflow: 120,
            Total_Outflow: 115,
            System_Mode: 'AUTO',
            Alarm_Status: false
        }
    };
}

/**
 * Update plant data from external JSON payload
 * Call this function to update the visualization with new data
 * @param {Object} payload - JSON object with plant data
 */
function updatePlantData(payload) {
    // Merge new payload with existing data
    plantData = { ...plantData, ...payload };

    // Update UI dashboard
    updateDashboard();
    updateLabels();
}

function updateDashboard() {
    // RWT - Raw Water Tank
    updateElement('rwt-level', plantData.RWT?.Level?.toFixed(1) + '%');
    updateElement('rwt-high-alarm', plantData.RWT?.High_Level_Alarm ? 'YES' : 'NO',
        plantData.RWT?.High_Level_Alarm ? 'alarm' : 'ok');
    updateElement('rwt-low-alarm', plantData.RWT?.Low_Level_Alarm ? 'YES' : 'NO',
        plantData.RWT?.Low_Level_Alarm ? 'alarm' : 'ok');
    updateElement('rwt-ph', plantData.RWT?.pH?.toFixed(1));
    updateElement('rwt-turbidity', plantData.RWT?.Turbidity?.toFixed(1) + ' NTU');
    updateElement('rwt-inflow', plantData.RWT?.Inflow_Rate?.toFixed(1) + ' m³/h');
    updateElement('rwt-outflow', plantData.RWT?.Outflow_Rate?.toFixed(1) + ' m³/h');

    // CST - Chemical Storage Tank
    updateElement('cst-level', plantData.CST?.Level?.toFixed(1) + '%');
    updateElement('cst-low-alarm', plantData.CST?.Low_Level_Alarm ? 'YES' : 'NO',
        plantData.CST?.Low_Level_Alarm ? 'alarm' : 'ok');

    // CFT - Coagulation/Flocculation Tank
    updateElement('cft-level', plantData.CFT?.Level?.toFixed(1) + '%');
    updateElement('cft-mixer', plantData.CFT?.Mixer_Status ? 'ON' : 'OFF',
        plantData.CFT?.Mixer_Status ? 'ok' : '');
    updateElement('cft-ph', plantData.CFT?.pH?.toFixed(1));
    updateElement('cft-turbidity', plantData.CFT?.Turbidity?.toFixed(1) + ' NTU');
    updateElement('cft-dosing', plantData.CFT?.Dosing_Rate?.toFixed(1) + ' L/h');

    // SCT - Sedimentation/Clarification Tank (use first tank if array)
    const sctData = Array.isArray(plantData.SCT) ? plantData.SCT[0] : plantData.SCT;
    updateElement('sct-level', sctData?.Level?.toFixed(1) + '%');
    updateElement('sct-sludge', sctData?.Sludge_Level?.toFixed(1) + '%');
    updateElement('sct-turbidity', sctData?.Turbidity_Outlet?.toFixed(1) + ' NTU');
    updateElement('sct-scraper', sctData?.Scraper_Status ? 'ON' : 'OFF',
        sctData?.Scraper_Status ? 'ok' : '');

    // FTR - Filter
    updateElement('ftr-flow', plantData.FTR?.Flow_Rate?.toFixed(1) + ' m³/h');
    updateElement('ftr-pressure', plantData.FTR?.Differential_Pressure?.toFixed(2) + ' bar');
    updateElement('ftr-backwash', plantData.FTR?.Backwash_Status ? 'ACTIVE' : 'OFF',
        plantData.FTR?.Backwash_Status ? 'warning' : '');

    // CWT - Clean Water Tank (use first tank if array)
    const cwtData = Array.isArray(plantData.CWT) ? plantData.CWT[0] : plantData.CWT;
    updateElement('cwt-level', cwtData?.Level?.toFixed(1) + '%');
    updateElement('cwt-high-alarm', cwtData?.High_Level_Alarm ? 'YES' : 'NO',
        cwtData?.High_Level_Alarm ? 'alarm' : 'ok');
    updateElement('cwt-low-alarm', cwtData?.Low_Level_Alarm ? 'YES' : 'NO',
        cwtData?.Low_Level_Alarm ? 'alarm' : 'ok');
    updateElement('cwt-ph', cwtData?.pH?.toFixed(1));
    updateElement('cwt-turbidity', cwtData?.Turbidity?.toFixed(1) + ' NTU');
    updateElement('cwt-chlorine', cwtData?.Residual_Chlorine?.toFixed(2) + ' mg/L');

    // SLT - Sludge Tank
    updateElement('slt-level', plantData.SLT?.Level?.toFixed(1) + '%');
    updateElement('slt-pump', plantData.SLT?.Pump_Status ? 'ON' : 'OFF',
        plantData.SLT?.Pump_Status ? 'ok' : '');

    // CDP - Chemical Dosing Pump
    updateElement('cdp-status-val', plantData.CDP?.Status ? 'ON' : 'OFF',
        plantData.CDP?.Status ? 'ok' : '');
    updateElement('cdp-mode', plantData.CDP?.Mode);
    updateElement('cdp-rate', plantData.CDP?.Dosing_Rate?.toFixed(1) + ' L/h');
    updateElement('cdp-total', plantData.CDP?.Total_Chemical_Used?.toFixed(0) + ' L');
    updateElement('cdp-pressure', plantData.CDP?.Pressure?.toFixed(1) + ' bar');
    updateElement('cdp-fault', plantData.CDP?.Fault ? 'YES' : 'NO',
        plantData.CDP?.Fault ? 'alarm' : 'ok');

    // PPS - Main Pump Station
    updateElement('pps-pump1', plantData.PPS?.Status ? 'ON' : 'OFF',
        plantData.PPS?.Status ? 'ok' : '');
    updateElement('pps-mode', plantData.PPS?.Mode);
    updateElement('pps-flow', plantData.PPS?.Flow_Rate?.toFixed(1) + ' m³/h');
    updateElement('pps-pressure', plantData.PPS?.Outlet_Pressure?.toFixed(1) + ' bar');
    updateElement('pps-fault', plantData.PPS?.Fault ? 'YES' : 'NO',
        plantData.PPS?.Fault ? 'alarm' : 'ok');

    // PLT - Plant Overall
    updateElement('plt-inflow', plantData.PLT?.Total_Inflow?.toFixed(1) + ' m³/h');
    updateElement('plt-outflow', plantData.PLT?.Total_Outflow?.toFixed(1) + ' m³/h');
    updateElement('plt-mode', plantData.PLT?.System_Mode || 'AUTO');
    updateElement('plt-alarm', plantData.PLT?.Alarm_Status ? 'YES' : 'NO',
        plantData.PLT?.Alarm_Status ? 'alarm' : 'ok');

    // System mode indicator
    const modeEl = document.getElementById('system-mode');
    if (modeEl) {
        modeEl.textContent = plantData.PLT?.System_Mode || 'AUTO';
        modeEl.className = 'mode' +
            (plantData.PLT?.System_Mode === 'MANUAL' ? ' manual' : '');
    }
}

function updateElement(id, value, statusClass = '') {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value || '--';
        el.className = 'value ' + statusClass;
    }
}

// ============================================================================
// SIMULATION (for testing without real data)
// ============================================================================

let simulationInterval = null;

function startSimulation() {
    if (simulationInterval) return;

    // Update data source indicator
    const dataSource = document.getElementById('data-source');
    if (dataSource) {
        dataSource.textContent = 'Data: Simulation';
        dataSource.style.color = '#ffd740';
    }

    // Show manual controls panel
    // document.getElementById('manual-controls').classList.add('active');

    simulationInterval = setInterval(() => {
        let simData;

        if (simulationMode === 'random') {
            // Random simulation mode
            simData = {
                RWT: {
                    Level: 50 + Math.random() * 40,
                    pH: 6.5 + Math.random() * 1.5,
                    Turbidity: 30 + Math.random() * 40,
                    Inflow_Rate: 100 + Math.random() * 50
                },
                CFT: {
                    Level: 40 + Math.random() * 40,
                    Mixer_Status: true,
                    pH: 6.0 + Math.random() * 1.5,
                    Turbidity: 15 + Math.random() * 20
                },
                CST: {
                    Level: 70 + Math.random() * 25
                },
                // SCT has 2 tanks - generate array of 2 values
                SCT: [
                    {
                        Level: 60 + Math.random() * 40,
                        Sludge_Level: 10 + Math.random() * 20,
                        Scraper_Status: true
                    },
                    {
                        Level: 55 + Math.random() * 45,
                        Sludge_Level: 8 + Math.random() * 22,
                        Scraper_Status: true
                    }
                ],
                // CWT has 2 tanks - generate array of 2 values
                CWT: [
                    {
                        Level: 70 + Math.random() * 30,
                        pH: 6.8 + Math.random() * 0.6,
                        Residual_Chlorine: 0.5 + Math.random() * 0.8
                    },
                    {
                        Level: 75 + Math.random() * 25,
                        pH: 6.9 + Math.random() * 0.5,
                        Residual_Chlorine: 0.6 + Math.random() * 0.7
                    }
                ],
                FTR: {
                    Flow_Rate: 80 + Math.random() * 40,
                    Differential_Pressure: 0.5 + Math.random() * 1
                },
                PPS: {
                    Status: Math.random() > 0.3,
                    Flow_Rate: 90 + Math.random() * 40
                },
                CDP: {
                    Status: true,
                    Dosing_Rate: 3 + Math.random() * 5
                },
                SLT: {
                    Level: 20 + Math.random() * 40
                }
            };
        } else {
            // Manual mode - use manual control values
            simData = {
                RWT: {
                    Level: manualValues.rwt.level,
                    pH: manualValues.rwt.ph,
                    Turbidity: manualValues.rwt.turbidity,
                    Inflow_Rate: 100 + Math.random() * 20,
                    High_Level_Alarm: manualValues.rwt.level > 95,
                    Low_Level_Alarm: manualValues.rwt.level < 10
                },
                CFT: {
                    Level: manualValues.cft.level,
                    Mixer_Status: manualValues.cft.mixer,
                    pH: 6.5 + Math.random() * 0.5,
                    Turbidity: manualValues.rwt.turbidity * 0.5
                },
                SCT: {
                    Level: manualValues.sct.level,
                    Sludge_Level: manualValues.sct.sludge,
                    Scraper_Status: manualValues.sct.scraper
                },
                CWT: {
                    Level: manualValues.cwt.level,
                    pH: 7.0 + Math.random() * 0.3,
                    Residual_Chlorine: manualValues.cwt.chlorine
                },
                FTR: {
                    Flow_Rate: 90 + Math.random() * 20,
                    Differential_Pressure: 0.6 + Math.random() * 0.4
                },
                PPS: {
                    Status: manualValues.pumps.pump1,
                    Flow_Rate: manualValues.pumps.pump1 ? 110 : 0
                },
                CDP: {
                    Status: manualValues.pumps.cdp,
                    Dosing_Rate: manualValues.pumps.cdp ? 4 + Math.random() * 2 : 0
                },
                SLT: {
                    Level: 30 + Math.random() * 20
                }
            };
        }

        updatePlantData(simData);
    }, CONFIG.updateInterval);
}

function stopSimulation() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }

    // Update data source indicator
    const dataSource = document.getElementById('data-source');
    if (dataSource) {
        dataSource.textContent = 'Data: Stopped';
        dataSource.style.color = '#888';
    }

    // Hide manual controls panel
    // document.getElementById('manual-controls').classList.remove('active');
}

// ============================================================================
// UI CONTROLS
// ============================================================================

function zoomIn() {
    if (!model) return;

    // Increase model scale by 10%
    const scaleStep = 0.1;
    const maxScale = 3.0; // Maximum model scale

    const newScale = Math.min(model.scale.x + scaleStep, maxScale);
    model.scale.set(newScale, newScale, newScale);
}

function zoomOut() {
    if (!model) return;

    // Decrease model scale by 10%
    const scaleStep = 0.1;
    const minScale = 0.3; // Minimum model scale

    const newScale = Math.max(model.scale.x - scaleStep, minScale);
    model.scale.set(newScale, newScale, newScale);
}

function setupControls() {
    document.getElementById('btn-reset-view').addEventListener('click', () => {
        camera.position.set(30, 25, 30);
        controls.target.set(0, 0, 0);
        controls.update();
    });

    document.getElementById('btn-toggle-labels').addEventListener('click', toggleLabels);

    // const simBtn = document.getElementById('btn-simulate');
    // simBtn.addEventListener('click', () => {
    //     if (simulationInterval) {
    //         stopSimulation();
    //         simBtn.classList.remove('active');
    //         simBtn.textContent = 'Simulate Data';
    //         // Restart API polling if available
    //         if (window.WTPAPI && !window.WTPAPI.isPolling()) {
    //             window.WTPAPI.startPolling();
    //         }
    //     } else {
    //         // Stop API polling when starting simulation
    //         if (window.WTPAPI && window.WTPAPI.isPolling()) {
    //             window.WTPAPI.stopPolling();
    //         }
    //         startSimulation();
    //         simBtn.classList.add('active');
    //         simBtn.textContent = 'Stop Simulation';
    //     }
    // });

    // document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
    // document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);

    // Manual control mode toggle
    // document.getElementById('mode-random').addEventListener('click', () => {
    //     simulationMode = 'random';
    //     document.getElementById('mode-random').classList.add('active');
    //     // document.getElementById('mode-manual').classList.remove('active');
    // });

    // document.getElementById('mode-manual').addEventListener('click', () => {
    //     simulationMode = 'manual';
    //     document.getElementById('mode-manual').classList.add('active');
    //     document.getElementById('mode-random').classList.remove('active');
    // });

    // RWT controls
    // setupSlider('ctrl-rwt-level', 'val-rwt-level', (val) => {
    //     manualValues.rwt.level = parseFloat(val);
    // }, '%');

    // setupSlider('ctrl-rwt-ph', 'val-rwt-ph', (val) => {
    //     manualValues.rwt.ph = parseFloat(val);
    // });

    // setupSlider('ctrl-rwt-turbidity', 'val-rwt-turbidity', (val) => {
    //     manualValues.rwt.turbidity = parseFloat(val);
    // }, ' NTU');

    // // CFT controls
    // setupSlider('ctrl-cft-level', 'val-cft-level', (val) => {
    //     manualValues.cft.level = parseFloat(val);
    // }, '%');

    // document.getElementById('ctrl-cft-mixer').addEventListener('change', (e) => {
    //     manualValues.cft.mixer = e.target.checked;
    // });

    // // SCT controls
    // setupSlider('ctrl-sct-level', 'val-sct-level', (val) => {
    //     manualValues.sct.level = parseFloat(val);
    // }, '%');

    // setupSlider('ctrl-sct-sludge', 'val-sct-sludge', (val) => {
    //     manualValues.sct.sludge = parseFloat(val);
    // }, '%');

    // document.getElementById('ctrl-sct-scraper').addEventListener('change', (e) => {
    //     manualValues.sct.scraper = e.target.checked;
    // });

    // // CWT controls
    // setupSlider('ctrl-cwt-level', 'val-cwt-level', (val) => {
    //     manualValues.cwt.level = parseFloat(val);
    // }, '%');

    // setupSlider('ctrl-cwt-chlorine', 'val-cwt-chlorine', (val) => {
    //     manualValues.cwt.chlorine = parseFloat(val);
    // }, ' mg/L');

    // // Pump controls
    // document.getElementById('ctrl-pump1').addEventListener('change', (e) => {
    //     manualValues.pumps.pump1 = e.target.checked;
    // });

    // document.getElementById('ctrl-pump2').addEventListener('change', (e) => {
    //     manualValues.pumps.pump2 = e.target.checked;
    // });

    // document.getElementById('ctrl-cdp').addEventListener('change', (e) => {
    //     manualValues.pumps.cdp = e.target.checked;
    // });
}

// function setupSlider(sliderId, valueId, callback, suffix = '') {
//     const slider = document.getElementById(sliderId);
//     const valueDisplay = document.getElementById(valueId);

//     slider.addEventListener('input', (e) => {
//         const value = e.target.value;
//         valueDisplay.textContent = value + suffix;
//         callback(value);
//     });
// }

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================================
// EXPORTS & INITIALIZATION
// ============================================================================

// Make updatePlantData available globally for external calls (Node-RED, etc.)
window.WTPVisualizer = {
    updatePlantData,
    clearData: () => {
        plantData = getDefaultPayload();
        updateDashboard();
        updateLabels();
    },
    startSimulation,
    stopSimulation,
    getPlantData: () => plantData,
    resetView: () => {
        camera.position.set(30, 25, 30);
        controls.target.set(0, 0, 0);
    },
    zoomIn,
    zoomOut
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
