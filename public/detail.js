const { debounce, escapeHtml, parseCode, buildChart, renderSvg, renderCanvas } = window.FlowChartLab;

const editor = document.getElementById("sourceInput");
const svgMount = document.getElementById("svgMount");
const canvas = document.getElementById("chartCanvas");
const previewHost = document.getElementById("previewHost");
const statusText = document.getElementById("statusText");
const resetButton = document.getElementById("resetSample");
const svgToggle = document.getElementById("svgToggle");
const canvasToggle = document.getElementById("canvasToggle");
const previewTitle = document.getElementById("previewTitle");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const fileNameLabel = document.getElementById("fileNameLabel");

const url = new URL(window.location.href);
const sampleId = url.searchParams.get("sample");

let originalSource = "";
let currentRenderer = url.searchParams.get("renderer") === "canvas" ? "canvas" : "svg";

function clearEmptyState() {
  const emptyState = previewHost.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }
}

function renderEmptyState(message) {
  svgMount.innerHTML = "";
  canvas.hidden = true;
  clearEmptyState();
  previewHost.insertAdjacentHTML("beforeend", `<div class="empty-state">${escapeHtml(message)}</div>`);
}

function setRenderer(renderer) {
  currentRenderer = renderer;
  svgToggle.classList.toggle("is-active", renderer === "svg");
  canvasToggle.classList.toggle("is-active", renderer === "canvas");
  previewTitle.textContent = renderer === "svg" ? "SVG Flow Chart" : "Canvas Flow Chart";

  url.searchParams.set("renderer", renderer);
  window.history.replaceState({}, "", url);
  updateChart();
}

function updateChart() {
  clearEmptyState();

  const source = editor.value.trim();
  if (!source) {
    renderEmptyState("Paste or edit code here to generate the flow chart.");
    statusText.textContent = "Waiting for source.";
    return;
  }

  try {
    const parsed = parseCode(editor.value);
    const chart = buildChart(parsed);

    if (currentRenderer === "svg") {
      svgMount.innerHTML = renderSvg(chart);
      canvas.hidden = true;
    } else {
      svgMount.innerHTML = "";
      renderCanvas(canvas, chart);
      canvas.hidden = false;
    }

    statusText.textContent = `${chart.nodes.length} nodes, ${chart.edges.length} edges.`;
  } catch (error) {
    renderEmptyState(`Could not parse this snippet: ${error.message}`);
    statusText.textContent = "Parse error.";
  }
}

function applySampleMeta(sample) {
  detailTitle.textContent = sample.name;
  detailMeta.textContent = sample.description;
  fileNameLabel.textContent = sample.name;
  document.title = `${sample.name} | Flow Chart Lab`;
}

async function loadSample() {
  if (!sampleId) {
    applySampleMeta({
      name: "Missing file",
      description: "No sample file was specified in the URL.",
    });
    renderEmptyState("Open a file from the homepage to see its detail view.");
    editor.value = "";
    statusText.textContent = "Missing sample.";
    return;
  }

  try {
    const indexResponse = await fetch("/samples/index.json");
    if (!indexResponse.ok) {
      throw new Error(`Could not load sample index: HTTP ${indexResponse.status}`);
    }

    const samples = await indexResponse.json();
    const sample = samples.find((item) => item.id === sampleId);

    if (!sample) {
      throw new Error(`Unknown sample: ${sampleId}`);
    }

    const sourceResponse = await fetch(`/samples/${encodeURIComponent(sample.id)}`);
    if (!sourceResponse.ok) {
      throw new Error(`Could not load file contents: HTTP ${sourceResponse.status}`);
    }

    originalSource = await sourceResponse.text();
    editor.value = originalSource;
    applySampleMeta(sample);
    updateChart();
  } catch (error) {
    applySampleMeta({
      name: "Load error",
      description: error.message,
    });
    editor.value = "";
    renderEmptyState(`Could not load this file: ${error.message}`);
    statusText.textContent = "Load error.";
  }
}

const debouncedUpdate = debounce(updateChart, 160);

editor.addEventListener("input", debouncedUpdate);
resetButton.addEventListener("click", () => {
  editor.value = originalSource;
  updateChart();
});
svgToggle.addEventListener("click", () => setRenderer("svg"));
canvasToggle.addEventListener("click", () => setRenderer("canvas"));

setRenderer(currentRenderer);
loadSample();
