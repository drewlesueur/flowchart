const { SAMPLE_CODE, debounce, escapeHtml, parseCode, buildChart, renderCanvas } = window.FlowChartLab;

const editor = document.getElementById("sourceInput");
const canvas = document.getElementById("chartCanvas");
const canvasHost = document.getElementById("canvasHost");
const statusText = document.getElementById("statusText");
const resetButton = document.getElementById("resetSample");

function renderEmptyState(message) {
  canvas.hidden = true;
  canvasHost.insertAdjacentHTML("beforeend", `<div class="empty-state">${escapeHtml(message)}</div>`);
}

function clearEmptyState() {
  const emptyState = canvasHost.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }
}

function updateChart() {
  const source = editor.value.trim();

  clearEmptyState();

  if (!source) {
    renderEmptyState("Paste some code on the left to generate a Canvas flow chart.");
    statusText.textContent = "Waiting for source.";
    return;
  }

  try {
    const parsed = parseCode(editor.value);
    const chart = buildChart(parsed);
    renderCanvas(canvas, chart);
    canvas.hidden = false;
    statusText.textContent = `${chart.nodes.length} nodes, ${chart.edges.length} edges.`;
  } catch (error) {
    renderEmptyState(`Could not parse this snippet: ${error.message}`);
    statusText.textContent = "Parse error.";
  }
}

const debouncedUpdate = debounce(updateChart, 160);

editor.value = SAMPLE_CODE;
editor.addEventListener("input", debouncedUpdate);
resetButton.addEventListener("click", () => {
  editor.value = SAMPLE_CODE;
  updateChart();
});

updateChart();
