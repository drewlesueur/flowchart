(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TrickleScriptRenderer = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const NS = "http://www.w3.org/2000/svg";
  const VIA_GOTO_EXIT_SIDE = "right";

  function el(tag, attrs, children) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    }
    if (typeof children === "string") {
      node.textContent = children;
    } else if (children) {
      for (const child of children) node.appendChild(child);
    }
    return node;
  }

  function pathForEdge(from, to, edge, graph) {
    const label = edge.label;
    const fromCx = from.x + from.w / 2;
    const fromCy = from.y + from.h / 2;
    const toCx = to.x + to.w / 2;
    const toCy = to.y + to.h / 2;
    const incomingCount = graph.edges.reduce((count, candidate) => {
      return count + (candidate.to === edge.to ? 1 : 0);
    }, 0);

    if (label === "Yes") {
      const startX = from.x + from.w + 15;
      const startY = fromCy;
      const endX = to.x;
      const endY = toCy;
      return {
        d: `M ${startX} ${startY} L ${endX} ${endY}`,
        labelX: startX + 8,
        labelY: startY - 6
      };
    }

    if (label === "No") {
      const startX = fromCx;
      const startY = from.y + from.h + 5;
      if (Math.abs(startX - toCx) < 2) {
        return {
          d: `M ${startX} ${startY} L ${toCx} ${to.y}`,
          labelX: startX + 8,
          labelY: startY + 16
        };
      }
      const bendY = to.y - 18;
      return {
        d: `M ${startX} ${startY} L ${startX} ${bendY} L ${toCx} ${bendY} L ${toCx} ${to.y}`,
        labelX: startX + 8,
        labelY: startY + 16
      };
    }

    if (edge.viaGoto) {
      const startFromRight = VIA_GOTO_EXIT_SIDE === "right";
      const startX = startFromRight ? from.x + from.w : fromCx;
      const startY = startFromRight ? fromCy : from.y + from.h;
      const laneY = startFromRight ? startY : startY + 22;
      const laneX = graph.totalWidth - 70;
      const targetY = toCy;

      return {
        d: `M ${startX} ${startY} L ${startX} ${laneY} L ${laneX} ${laneY} L ${laneX} ${targetY} L ${to.x + to.w} ${targetY}`
      };
    }

    if (to.row <= from.row) {
      const startX = from.x + from.w;
      const startY = fromCy;
      const laneX = Math.max(startX, to.x + to.w) + 34;
      return { d: `M ${startX} ${startY} L ${laneX} ${startY} L ${laneX} ${toCy} L ${to.x + to.w} ${toCy}` };
    }

    if (incomingCount > 1) {
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

  function populateEntries(program, selectEl, selected) {
    const desired = selected || selectEl.value || (program.routineMap.main ? "main" : program.routines[0].name);
    selectEl.innerHTML = "";

    for (const routine of program.routines) {
      const option = document.createElement("option");
      option.value = routine.name;
      option.textContent = routine.name;
      if (routine.name === desired) option.selected = true;
      selectEl.appendChild(option);
    }
  }

  function render(graph, mountEl) {
    mountEl.innerHTML = "";
    const svg = el("svg", {
      width: graph.totalWidth,
      height: graph.totalHeight,
      viewBox: `0 0 ${graph.totalWidth} ${graph.totalHeight}`,
      xmlns: NS
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
      fill: "#4a6fa5"
    });
    marker.appendChild(el("path", { d: "M 0 0 L 10 5 L 0 10 z" }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const nodeMap = {};
    for (const node of graph.nodes) nodeMap[node.id] = node;

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
        "marker-end": "url(#arrow)"
      }));

      if (edge.label) {
        svg.appendChild(el("text", {
          x: result.labelX,
          y: result.labelY,
          fill: "#e94560",
          "font-size": "11",
          "font-family": "-apple-system, sans-serif"
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
          stroke: "#e94560", "stroke-width": "2"
        }));
      } else if (node.type === "decision") {
        svg.appendChild(el("polygon", {
          points: `${cx},${y - 5} ${x + w + 15},${cy} ${cx},${y + h + 5} ${x - 15},${cy}`,
          fill: "#16213e",
          stroke: "#e9a645",
          "stroke-width": "2"
        }));
      } else if (node.type === "return") {
        svg.appendChild(el("polygon", {
          points: `${x + 12},${y} ${x + w},${y} ${x + w - 12},${y + h} ${x},${y + h}`,
          fill: "#16213e",
          stroke: "#45e980",
          "stroke-width": "2"
        }));
      } else {
        svg.appendChild(el("rect", {
          x, y, width: w, height: h,
          fill: "#16213e",
          stroke: "#4a6fa5",
          "stroke-width": "1.5"
        }));
      }

      let label = node.label;
      const maxChars = 24;
      if (label.length > maxChars) label = label.slice(0, maxChars - 1) + "\u2026";
      svg.appendChild(el("text", {
        x: cx,
        y: cy,
        fill: "#e0e0e0",
        "font-size": "12",
        "font-family": '"Courier New", monospace',
        "text-anchor": "middle",
        "dominant-baseline": "central"
      }, label));
    }

    mountEl.appendChild(svg);
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
      const xDelta = 60;
      const rowDelta = to.row - from.row;
      shiftBranch(edge.to, Math.max(0, rowDelta), xDelta);
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

  return {
    populateEntries,
    render,
    alignYesTargets
  };
});
