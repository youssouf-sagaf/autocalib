// State
let sources = [];
let currentSource = "mapbox";
let runs = [];
let currentIndex = 0;
let currentData = null;
let map = null;
let parkingZoneLayer = null;
let markersLayer = null;
let markersVisible = false;

// DOM refs
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnGenerate = document.getElementById("btn-generate");
const navLabel = document.getElementById("nav-label");
const sourceSelector = document.getElementById("source-selector");

function buildSourceButtons(sourceList, defaultSource) {
    sourceSelector.innerHTML = "";
    sourceList.forEach((src) => {
        const btn = document.createElement("button");
        btn.className = "source-btn" + (src.name === defaultSource ? " active" : "");
        btn.dataset.source = src.name;
        btn.textContent = `${src.name.toUpperCase()} (${src.count})`;
        btn.addEventListener("click", () => switchSource(src.name));
        sourceSelector.appendChild(btn);
    });
}

async function switchSource(source) {
    if (source === currentSource) return;
    currentSource = source;

    sourceSelector.querySelectorAll(".source-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.source === source);
    });

    await fetchRuns();
}

async function fetchRuns() {
    const resp = await fetch(`/api/runs?source=${currentSource}`);
    const data = await resp.json();
    runs = data.runs;

    if (runs.length > 0) {
        loadRun(0);
    } else {
        navLabel.textContent = `No runs for ${currentSource}`;
        clearDisplay();
    }
}

function clearDisplay() {
    document.getElementById("img-original").removeAttribute("src");
    document.getElementById("img-segmentation").removeAttribute("src");
    document.getElementById("img-detection").removeAttribute("src");
    document.getElementById("img-postprocess").removeAttribute("src");
    if (parkingZoneLayer) {
        map.removeLayer(parkingZoneLayer);
        parkingZoneLayer = null;
    }
    markersLayer.clearLayers();
    markersVisible = false;
    btnGenerate.textContent = "Generate Markers";
    btnGenerate.classList.remove("active");
    currentData = null;
}

document.addEventListener("DOMContentLoaded", async () => {
    map = L.map("map").setView([48.86, 2.35], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);

    btnPrev.addEventListener("click", () => loadRun(currentIndex - 1));
    btnNext.addEventListener("click", () => loadRun(currentIndex + 1));
    btnGenerate.addEventListener("click", toggleMarkers);

    const srcResp = await fetch("/api/sources");
    const srcData = await srcResp.json();
    sources = srcData.sources;
    currentSource = srcData.default;

    buildSourceButtons(sources, currentSource);
    await fetchRuns();
});

async function loadRun(index) {
    if (index < 0 || index >= runs.length) return;
    currentIndex = index;
    const name = runs[currentIndex];
    const sq = `source=${currentSource}`;

    navLabel.textContent = `${name} (${currentIndex + 1}/${runs.length})`;
    btnPrev.disabled = currentIndex === 0;
    btnNext.disabled = currentIndex === runs.length - 1;

    document.getElementById("img-original").src = `/api/runs/${name}/image/original?${sq}`;
    document.getElementById("img-segmentation").src = `/api/runs/${name}/image/segmentation?${sq}`;
    document.getElementById("img-detection").src = `/api/runs/${name}/image/detection?${sq}`;
    document.getElementById("img-postprocess").src = `/api/runs/${name}/image/postprocess?${sq}`;

    if (parkingZoneLayer) {
        map.removeLayer(parkingZoneLayer);
        parkingZoneLayer = null;
    }
    markersLayer.clearLayers();
    markersVisible = false;
    btnGenerate.textContent = "Generate Markers";
    btnGenerate.classList.remove("active");

    const resp = await fetch(`/api/runs/${name}?${sq}`);
    currentData = await resp.json();

    if (currentData.mapbox_token && !map._hasSatellite) {
        map.eachLayer((layer) => {
            if (layer instanceof L.TileLayer) map.removeLayer(layer);
        });
        L.tileLayer(
            "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.png?access_token=" + currentData.mapbox_token,
            { attribution: "&copy; Mapbox", maxZoom: 22, tileSize: 512, zoomOffset: -1 }
        ).addTo(map);
        map._hasSatellite = true;
    }

    const b = currentData.parking_zone.bounds;
    parkingZoneLayer = L.rectangle(
        [[b.south, b.west], [b.north, b.east]],
        { color: "#ff7800", weight: 2, fillOpacity: 0.05, dashArray: "6 4" }
    ).addTo(map);
    map.fitBounds(parkingZoneLayer.getBounds(), { padding: [20, 20] });
}

function toggleMarkers() {
    if (!currentData) return;

    if (markersVisible) {
        markersLayer.clearLayers();
        markersVisible = false;
        btnGenerate.textContent = "Generate Markers";
        btnGenerate.classList.remove("active");
    } else {
        if (currentData.slots.length === 0) return;
        currentData.slots.forEach((slot) => {
            const marker = L.circleMarker([slot.center[1], slot.center[0]], {
                radius: 6,
                fillColor: "#2196f3",
                color: "#1565c0",
                weight: 1.5,
                fillOpacity: 0.85,
            });
            marker.bindPopup(
                `<b>Slot ${slot.slot_id}</b><br>` +
                `Status: ${slot.status}<br>` +
                `Confidence: ${(slot.confidence * 100).toFixed(1)}%<br>` +
                `Source: ${slot.source}`
            );
            marker.addTo(markersLayer);
        });
        markersVisible = true;
        btnGenerate.textContent = "Hide Markers";
        btnGenerate.classList.add("active");
    }
}
