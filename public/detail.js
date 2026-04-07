const editor = document.getElementById("sourceInput");
const svgMount = document.getElementById("svgMount");
const phase2Mount = document.getElementById("phase2Mount");
const previewHost = document.getElementById("previewHost");
const statusText = document.getElementById("statusText");
const resetButton = document.getElementById("resetSample");
const saveButton = document.getElementById("saveFile");
const entrySelect = document.getElementById("entrySelect");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const fileNameLabel = document.getElementById("fileNameLabel");
const tabClassic = document.getElementById("tabClassic");
const tabPhase2 = document.getElementById("tabPhase2");
const panelClassic = document.getElementById("panelClassic");
const panelPhase2 = document.getElementById("panelPhase2");

const url = new URL(window.location.href);
const sampleId = url.searchParams.get("sample");
const renderer = window.TrickleScriptRenderer;
const rendererV2 = window.TrickleScriptRendererV2;

let originalSource = "";
let activeTab = "classic";
let phase2View = null;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function debounce(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  };
}

function clearEmptyState() {
  const emptyState = previewHost.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }
}

function renderEmptyState(message) {
  svgMount.innerHTML = "";
  if (phase2View) {
    phase2View.destroy();
    phase2View = null;
  } else {
    phase2Mount.innerHTML = "";
  }
  clearEmptyState();
  previewHost.insertAdjacentHTML("beforeend", `<div class="empty-state">${escapeHtml(message)}</div>`);
}

function setActiveTab(tabName) {
  activeTab = tabName;
  const classicActive = tabName === "classic";
  tabClassic.classList.toggle("is-active", classicActive);
  tabPhase2.classList.toggle("is-active", !classicActive);
  tabClassic.setAttribute("aria-selected", classicActive ? "true" : "false");
  tabPhase2.setAttribute("aria-selected", classicActive ? "false" : "true");
  panelClassic.classList.toggle("is-active", classicActive);
  panelPhase2.classList.toggle("is-active", !classicActive);
  panelClassic.setAttribute("aria-hidden", classicActive ? "false" : "true");
  panelPhase2.setAttribute("aria-hidden", classicActive ? "true" : "false");
  if (!classicActive && phase2View && typeof phase2View.refresh === "function") {
    phase2View.refresh();
  }
}

function updateChart(selectedEntry) {
  clearEmptyState();

  if (!editor.value.trim()) {
    renderEmptyState("Add TrickleScript on the left to generate a flow chart.");
    statusText.textContent = "Waiting for source";
    return;
  }

  try {
    const program = TrickleScript.parse(editor.value);
    renderer.populateEntries(program, entrySelect, selectedEntry);
    const entry = entrySelect.value || (program.routineMap.main ? "main" : program.routines[0].name);
    const graph = TrickleScript.buildFlowGraph(program, { entry });
    renderer.render(renderer.alignYesTargets(graph), svgMount);
    if (phase2View) {
      phase2View.destroy();
      phase2View = null;
    }
    phase2View = rendererV2.mount(graph, phase2Mount);
    statusText.textContent = `${entry} • ${graph.nodes.length - 2} steps`;
  } catch (error) {
    renderEmptyState(`Could not parse this file: ${error.message}`);
    statusText.textContent = "Parse error";
  }
}

function applySampleMeta(sample) {
  detailTitle.textContent = sample.name;
  detailMeta.textContent = sample.description;
  fileNameLabel.textContent = sample.name;
  document.title = `${sample.name} | TrickleScript Flowchart`;
}

async function loadSample() {
  if (!sampleId) {
    applySampleMeta({ name: "Missing file", description: "No file was specified." });
    editor.value = "";
    renderEmptyState("Open a TrickleScript file from the home page.");
    statusText.textContent = "Missing file";
    return;
  }

  try {
    const indexResponse = await fetch("/api/files");
    if (!indexResponse.ok) {
      throw new Error(`Could not load file list: HTTP ${indexResponse.status}`);
    }

    const files = await indexResponse.json();
    const file = files.find((item) => item.id === sampleId);
    if (!file) {
      throw new Error(`Unknown file: ${sampleId}`);
    }

    const sourceResponse = await fetch(`/api/files/${encodeURIComponent(file.id)}`);
    if (!sourceResponse.ok) {
      throw new Error(`Could not load file: HTTP ${sourceResponse.status}`);
    }

    originalSource = await sourceResponse.text();
    editor.value = originalSource;
    applySampleMeta(file);
    updateChart("main");
  } catch (error) {
    applySampleMeta({ name: "Load error", description: error.message });
    editor.value = "";
    renderEmptyState(`Could not load this file: ${error.message}`);
    statusText.textContent = "Load error";
  }
}

async function saveSample() {
  if (!sampleId) {
    detailMeta.textContent = "No file selected.";
    return;
  }

  detailMeta.textContent = "Saving...";

  try {
    const response = await fetch(`/api/files/${encodeURIComponent(sampleId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editor.value }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    originalSource = editor.value;
    detailMeta.textContent = "Saved";
    updateChart(entrySelect.value);
  } catch (error) {
    detailMeta.textContent = `Save failed: ${error.message}`;
  }
}

const debouncedUpdate = debounce(() => updateChart(entrySelect.value), 220);

editor.addEventListener("input", debouncedUpdate);
editor.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.value = `${editor.value.slice(0, start)}  ${editor.value.slice(end)}`;
  editor.selectionStart = editor.selectionEnd = start + 2;
});
entrySelect.addEventListener("change", () => updateChart(entrySelect.value));
resetButton.addEventListener("click", () => {
  editor.value = originalSource;
  updateChart(entrySelect.value);
});
saveButton.addEventListener("click", saveSample);
tabClassic.addEventListener("click", () => setActiveTab("classic"));
tabPhase2.addEventListener("click", () => setActiveTab("phase2"));

loadSample();
