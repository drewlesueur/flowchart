const NS = "http://www.w3.org/2000/svg";
const VIA_GOTO_EXIT_SIDE = "right";

const editor = document.getElementById("sourceInput");
const svgMount = document.getElementById("svgMount");
const previewHost = document.getElementById("previewHost");
const statusText = document.getElementById("statusText");
const resetButton = document.getElementById("resetSample");
const saveButton = document.getElementById("saveFile");
const entrySelect = document.getElementById("entrySelect");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const fileNameLabel = document.getElementById("fileNameLabel");

const url = new URL(window.location.href);
const sampleId = url.searchParams.get("sample");

let originalSource = "";

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

function el(tag, attrs, children) {
  const node = document.createElementNS(NS, tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
  }
  if (typeof children === "string") {
    node.textContent = children;
  } else if (children) {
    for (const child of children) {
      node.appendChild(child);
    }
  }
  return node;
}

function clearEmptyState() {
  const emptyState = previewHost.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }
}

function renderEmptyState(message) {
  svgMount.innerHTML = "";
  clearEmptyState();
  previewHost.insertAdjacentHTML("beforeend", `<div class="empty-state">${escapeHtml(message)}</div>`);
}

function pathForEdge(from, to, edge, graph) {
  const label = edge.label;
  const fromCx = from.x + from.w / 2;
  const fromCy = from.y + from.h / 2;
  const toCx = to.x + to.w / 2;
  const toCy = to.y + to.h / 2;

  if (label === "Yes") {
    const startX = from.x + from.w + 15;
    const startY = fromCy;
    return {
      d: `M ${startX} ${startY} L ${to.x} ${toCy}`,
      labelX: startX + 8,
      labelY: startY - 6,
    };
  }

  if (label === "No") {
    const startX = fromCx;
    const startY = from.y + from.h + 5;
    if (Math.abs(startX - toCx) < 2) {
      return {
        d: `M ${startX} ${startY} L ${toCx} ${to.y}`,
        labelX: startX + 8,
        labelY: startY + 16,
      };
    }
    const bendY = to.y - 18;
    return {
      d: `M ${startX} ${startY} L ${startX} ${bendY} L ${toCx} ${bendY} L ${toCx} ${to.y}`,
      labelX: startX + 8,
      labelY: startY + 16,
    };
  }

  if (edge.viaGoto) {
    const laneIsClear = (x, y1, y2) => graph.nodes.every((node) => {
      const pos = graph.positions[node.id];
      if (!pos || node.id === edge.from || node.id === edge.to) return true;
      if (pos.y <= y1 || pos.y >= y2) return true;
      return x < pos.x || x > pos.x + pos.w;
    });

    const canDropStraightDown =
      Math.abs(from.x + from.w / 2 - toCx) < 2 &&
      to.y > from.y &&
      laneIsClear(fromCx, from.y, to.y);

    if (canDropStraightDown) {
      return { d: `M ${fromCx} ${from.y + from.h} L ${toCx} ${to.y}` };
    }

    const startFromRight = VIA_GOTO_EXIT_SIDE === "right";
    const startX = startFromRight ? from.x + from.w : fromCx;
    const startY = startFromRight ? fromCy : from.y + from.h;
    const laneY = startFromRight ? startY : startY + 22;
    const laneX = Math.max(startX, to.x + to.w) + 34;
    const targetY = toCy;

    if (startFromRight && to.y > from.y && laneIsClear(startX, from.y, targetY)) {
      return {
        d: `M ${startX} ${startY} L ${startX} ${targetY} L ${to.x + to.w} ${targetY}`,
      };
    }

    return {
      d: `M ${startX} ${startY} L ${startX} ${laneY} L ${laneX} ${laneY} L ${laneX} ${targetY} L ${to.x + to.w} ${targetY}`,
    };
  }

  if (to.row <= from.row) {
    const startX = from.x + from.w;
    const startY = fromCy;
    const laneX = Math.max(startX, to.x + to.w) + 34;
    return { d: `M ${startX} ${startY} L ${laneX} ${startY} L ${laneX} ${toCy} L ${to.x + to.w} ${toCy}` };
  }

  if (Math.abs(fromCx - toCx) < 2) {
    return { d: `M ${fromCx} ${from.y + from.h} L ${toCx} ${to.y}` };
  }

  const bendY = to.y - 22;
  return { d: `M ${fromCx} ${from.y + from.h} L ${fromCx} ${bendY} L ${toCx} ${bendY} L ${toCx} ${to.y}` };
}

function populateEntries(program, selected) {
  const desired = selected || entrySelect.value || (program.routineMap.main ? "main" : program.routines[0]?.name);
  entrySelect.innerHTML = "";

  for (const routine of program.routines) {
    const option = document.createElement("option");
    option.value = routine.name;
    option.textContent = routine.name;
    if (routine.name === desired) {
      option.selected = true;
    }
    entrySelect.appendChild(option);
  }
}

function render(graph) {
  svgMount.innerHTML = "";

  const svg = el("svg", {
    width: graph.totalWidth,
    height: graph.totalHeight,
    viewBox: `0 0 ${graph.totalWidth} ${graph.totalHeight}`,
    xmlns: NS,
  });

  const defs = el("defs");
  const marker = el("marker", {
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: "10",
    refY: "5",
    markerWidth: "8",
    markerHeight: "8",
    orient: "auto-start-reverse",
    fill: "#4a6fa5",
  });
  marker.appendChild(el("path", { d: "M 0 0 L 10 5 L 0 10 z" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (const edge of graph.edges) {
    const from = graph.positions[edge.from];
    const to = graph.positions[edge.to];
    if (!from || !to) continue;

    const result = pathForEdge(from, to, edge, graph);
    svg.appendChild(el("path", {
      d: result.d,
      stroke: "#4a6fa5",
      "stroke-width": "1.5",
      fill: "none",
      "marker-end": "url(#arrow)",
    }));

    if (edge.label) {
      svg.appendChild(el("text", {
        x: result.labelX,
        y: result.labelY,
        fill: "#e94560",
        "font-size": "11",
        "font-family": "-apple-system, sans-serif",
      }, edge.label));
    }
  }

  for (const node of graph.nodes) {
    const pos = graph.positions[node.id];
    if (!pos) continue;

    const x = pos.x;
    const y = pos.y;
    const w = pos.w;
    const h = pos.h;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (node.type === "start" || node.type === "end") {
      svg.appendChild(el("rect", {
        x, y, width: w, height: h, rx: h / 2, ry: h / 2,
        fill: node.type === "start" ? "#0f3460" : "#1a1a2e",
        stroke: "#e94560",
        "stroke-width": "2",
      }));
    } else if (node.type === "decision") {
      svg.appendChild(el("polygon", {
        points: `${cx},${y - 5} ${x + w + 15},${cy} ${cx},${y + h + 5} ${x - 15},${cy}`,
        fill: "#16213e",
        stroke: "#e9a645",
        "stroke-width": "2",
      }));
    } else if (node.type === "return") {
      svg.appendChild(el("polygon", {
        points: `${x + 12},${y} ${x + w},${y} ${x + w - 12},${y + h} ${x},${y + h}`,
        fill: "#16213e",
        stroke: "#45e980",
        "stroke-width": "2",
      }));
    } else {
      svg.appendChild(el("rect", {
        x, y, width: w, height: h,
        fill: "#16213e",
        stroke: "#4a6fa5",
        "stroke-width": "1.5",
      }));
    }

    let label = node.label;
    if (label.length > 24) {
      label = `${label.slice(0, 23)}…`;
    }

    svg.appendChild(el("text", {
      x: cx,
      y: cy,
      fill: "#e0e0e0",
      "font-size": "12",
      "font-family": "\"Courier New\", monospace",
      "text-anchor": "middle",
      "dominant-baseline": "central",
    }, label));
  }

  svgMount.appendChild(svg);
}

function alignYesTargets(graph) {
  const positions = {};
  for (const [id, pos] of Object.entries(graph.positions)) {
    positions[id] = { ...pos };
  }

  const outgoing = {};
  const incomingCount = {};
  for (const node of graph.nodes) {
    outgoing[node.id] = [];
    incomingCount[node.id] = 0;
  }

  for (const edge of graph.edges) {
    outgoing[edge.from].push(edge);
    incomingCount[edge.to] += 1;
  }

  function shiftBranch(startId, rowDelta, xDelta) {
    const queue = [startId];
    const seen = new Set();

    while (queue.length) {
      const nodeId = queue.shift();
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);

      const pos = positions[nodeId];
      if (!pos) continue;
      pos.row -= rowDelta;
      pos.y -= rowDelta * 120;
      pos.x += xDelta;
      pos.col += xDelta / 230;

      for (const edge of outgoing[nodeId] || []) {
        if (incomingCount[edge.to] > 1) continue;
        queue.push(edge.to);
      }
    }
  }

  for (const edge of graph.edges) {
    if (edge.label !== "Yes") continue;
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) continue;
    shiftBranch(edge.to, Math.max(0, to.row - from.row), 60);
  }

  for (const edge of graph.edges) {
    if (edge.label !== "No") continue;
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) continue;
    const xDelta = from.x - to.x;
    if (Math.abs(xDelta) > 1) {
      shiftBranch(edge.to, 0, xDelta);
    }
  }

  const rowValues = Array.from(new Set(Object.values(positions).map((pos) => pos.row))).sort((a, b) => a - b);
  const rowMap = new Map(rowValues.map((row, index) => [row, index]));
  for (const pos of Object.values(positions)) {
    pos.row = rowMap.get(pos.row);
    pos.y = 40 + pos.row * 120;
  }

  let maxRight = graph.totalWidth;
  let maxBottom = graph.totalHeight;
  for (const pos of Object.values(positions)) {
    maxRight = Math.max(maxRight, pos.x + pos.w + 130);
    maxBottom = Math.max(maxBottom, pos.y + pos.h + 80);
  }

  return { ...graph, positions, totalWidth: maxRight, totalHeight: maxBottom };
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
    populateEntries(program, selectedEntry);
    const entry = entrySelect.value || (program.routineMap.main ? "main" : program.routines[0].name);
    const graph = TrickleScript.buildFlowGraph(program, { entry });
    render(alignYesTargets(graph));
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

loadSample();
