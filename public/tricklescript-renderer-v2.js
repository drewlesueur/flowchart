(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TrickleScriptRendererV2 = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const NS = "http://www.w3.org/2000/svg";
  const NODE_W = 176;
  const NODE_H = 56;
  const GAP_Y = 34;
  const BRANCH_GAP = 24;
  const BRANCH_X = 248;
  const YES_INDENT = 0;
  const PADDING = 48;
  const CULL_PAD = 220;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
      for (const child of children) node.appendChild(child);
    }
    return node;
  }

  function truncateLabel(label, maxChars) {
    if (label.length <= maxChars) return label;
    return label.slice(0, maxChars - 1) + "\u2026";
  }

  function getDetailDepth(zoom) {
    if (zoom < 0.8) return 0;
    if (zoom < 1.45) return 1;
    if (zoom < 2.2) return 2;
    return 4;
  }

  function buildFlowTree(graph) {
    const nodeMap = Object.create(null);
    const edgeMap = Object.create(null);
    const adjacency = Object.create(null);

    for (const node of graph.nodes) {
      nodeMap[node.id] = node;
      edgeMap[node.id] = [];
      adjacency[node.id] = [];
    }

    for (const edge of graph.edges) {
      if (!edgeMap[edge.from]) edgeMap[edge.from] = [];
      edgeMap[edge.from].push(edge);
      if (!adjacency[edge.from]) adjacency[edge.from] = [];
      adjacency[edge.from].push(edge.to);
    }

    function unlabeledTarget(nodeId) {
      const edge = (edgeMap[nodeId] || []).find((candidate) => !candidate.label);
      return edge ? edge.to : null;
    }

    function branchTarget(nodeId, label) {
      const edge = (edgeMap[nodeId] || []).find((candidate) => candidate.label === label);
      return edge ? edge.to : null;
    }

    function nodeRank(nodeId) {
      const node = nodeMap[nodeId];
      if (!node) return Number.MAX_SAFE_INTEGER;
      if (node.id === "end") return Number.MAX_SAFE_INTEGER - 1;
      if (node.id === "start") return -1;
      return typeof node.instructionIndex === "number" ? node.instructionIndex : Number.MAX_SAFE_INTEGER - 2;
    }

    function walkDistances(startId) {
      const distances = new Map();
      const queue = [{ id: startId, distance: 0 }];

      while (queue.length) {
        const current = queue.shift();
        if (!current || current.id == null) continue;
        if (distances.has(current.id)) continue;
        distances.set(current.id, current.distance);

        for (const nextId of adjacency[current.id] || []) {
          queue.push({ id: nextId, distance: current.distance + 1 });
        }
      }

      return distances;
    }

    function findMerge(yesId, noId) {
      if (!yesId || !noId) return yesId || noId || "end";
      if (yesId === noId) return yesId;

      const yesDistances = walkDistances(yesId);
      const noDistances = walkDistances(noId);
      const candidates = [];

      for (const [nodeId, yesDistance] of yesDistances.entries()) {
        if (!noDistances.has(nodeId)) continue;
        candidates.push({
          nodeId,
          score: Math.max(yesDistance, noDistances.get(nodeId)),
          rank: nodeRank(nodeId)
        });
      }

      if (!candidates.length) return "end";

      candidates.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.rank - b.rank;
      });

      return candidates[0].nodeId;
    }

    function buildSequence(startId, stopIds, ancestry) {
      const items = [];
      const stop = stopIds || new Set();
      const path = ancestry || new Set();
      let currentId = startId;

      while (currentId && !stop.has(currentId)) {
        const node = nodeMap[currentId];
        if (!node) break;

        if (path.has(currentId)) {
          items.push({ kind: "reference", nodeId: currentId, label: truncateLabel(node.label || currentId, 24) });
          break;
        }

        if (node.id === "end") {
          items.push({ kind: "node", nodeId: node.id });
          break;
        }

        if (node.type === "decision") {
          const nextPath = new Set(path);
          nextPath.add(currentId);
          const yesId = branchTarget(currentId, "Yes");
          const noId = branchTarget(currentId, "No");
          const mergeId = findMerge(yesId, noId);
          const branchStop = new Set(stop);
          if (mergeId) branchStop.add(mergeId);
          items.push({
            kind: "decision",
            nodeId: currentId,
            yesId,
            noId,
            mergeId,
            yes: buildSequence(yesId, branchStop, nextPath),
            no: buildSequence(noId, branchStop, nextPath)
          });
          currentId = mergeId;
          continue;
        }

        items.push({ kind: "node", nodeId: currentId });
        currentId = unlabeledTarget(currentId);
      }

      return items;
    }

    return {
      graph,
      nodeMap,
      edgeMap,
      root: buildSequence("start", new Set(), new Set())
    };
  }

  function buildScene(tree, options) {
    const zoom = options && typeof options.zoom === "number" ? options.zoom : 1;
    const depthLimit = options && typeof options.depthLimit === "number" ? options.depthLimit : getDetailDepth(zoom);
    const viewport = options && options.viewport ? options.viewport : {
      left: -Infinity,
      top: -Infinity,
      right: Infinity,
      bottom: Infinity
    };

    const scene = {
      width: 0,
      height: 0,
      shapes: [],
      labels: [],
      paths: [],
      badges: [],
      nodes: []
    };

    function inView(x, y, width, height) {
      return !(
        x + width < viewport.left - CULL_PAD ||
        y + height < viewport.top - CULL_PAD ||
        x > viewport.right + CULL_PAD ||
        y > viewport.bottom + CULL_PAD
      );
    }

    function addNodeShape(nodeId, x, y, mode) {
      const node = tree.nodeMap[nodeId];
      if (!node) return;
      const box = { x, y, w: NODE_W, h: NODE_H };
      if (!inView(box.x, box.y, box.w, box.h)) return;

      scene.nodes.push({ id: nodeId, type: node.type, label: node.label, mode, depth: mode === "detail" ? 1 : 0, ...box });
      scene.shapes.push({ id: nodeId, type: node.type, mode, ...box });
      scene.labels.push({
        id: nodeId,
        text: truncateLabel(node.label, mode === "detail" ? 28 : 22),
        x: x + NODE_W / 2,
        y: y + NODE_H / 2
      });
    }

    function addReference(item, x, y) {
      if (!inView(x, y, NODE_W, NODE_H - 12)) return;
      scene.shapes.push({ type: "reference", x, y, w: NODE_W, h: NODE_H - 12 });
      scene.labels.push({ text: "Loop to " + item.label, x: x + NODE_W / 2, y: y + (NODE_H - 12) / 2 });
    }

    function addPath(points, mode) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }

      if (!inView(minX, minY, maxX - minX, maxY - minY)) return;
      scene.paths.push({ points, mode });
    }

    function addBadge(text, x, y) {
      if (!inView(x, y, 64, 24)) return;
      scene.badges.push({ text, x, y });
    }

    function layoutSequence(items, x, y, depth) {
      let cursorY = y;
      let prevExit = null;
      let maxRight = x + NODE_W;

      for (const item of items) {
        const layout = layoutItem(item, x, cursorY, depth);
        if (prevExit && layout.entry) {
          addPath([
            prevExit,
            { x: prevExit.x, y: prevExit.y + GAP_Y / 2 },
            { x: layout.entry.x, y: layout.entry.y - GAP_Y / 2 },
            layout.entry
          ], "main");
        }
        prevExit = layout.exit;
        cursorY += layout.height + GAP_Y;
        maxRight = Math.max(maxRight, layout.right);
      }

      return {
        width: maxRight - x,
        height: Math.max(0, cursorY - y - GAP_Y),
        entry: items.length ? { x: x + NODE_W / 2, y } : null,
        exit: prevExit,
        right: maxRight
      };
    }

    function layoutItem(item, x, y, depth) {
      if (item.kind === "reference") {
        addReference(item, x, y + 6);
        return {
          height: NODE_H - 12,
          entry: { x: x + NODE_W / 2, y: y + 6 },
          exit: { x: x + NODE_W / 2, y: y + NODE_H - 6 },
          right: x + NODE_W
        };
      }

      if (item.kind === "node") {
        addNodeShape(item.nodeId, x, y, depth > 0 ? "detail" : "summary");
        return {
          height: NODE_H,
          entry: { x: x + NODE_W / 2, y },
          exit: { x: x + NODE_W / 2, y: y + NODE_H },
          right: x + NODE_W
        };
      }

      addNodeShape(item.nodeId, x, y, depth > 0 ? "detail" : "summary");

      if (depth >= depthLimit) {
        addBadge("Yes", x + 18, y + NODE_H + 10);
        addBadge("No", x + NODE_W + 28, y + NODE_H / 2 - 10);
        addPath([
          { x: x + NODE_W / 2, y: y + NODE_H },
          { x: x + NODE_W / 2, y: y + NODE_H + 22 }
        ], "branch");
        addPath([
          { x: x + NODE_W, y: y + NODE_H / 2 },
          { x: x + NODE_W + 36, y: y + NODE_H / 2 }
        ], "branch");

        return {
          height: NODE_H + 32,
          entry: { x: x + NODE_W / 2, y },
          exit: { x: x + NODE_W / 2, y: y + NODE_H + 32 },
          right: x + NODE_W + 56
        };
      }

      const yesLayout = item.yes.length
        ? layoutSequence(item.yes, x + YES_INDENT, y + NODE_H + BRANCH_GAP, depth + 1)
        : { width: NODE_W, height: 0, entry: null, exit: null, right: x + NODE_W };
      const noLayout = item.no.length
        ? layoutSequence(item.no, x + BRANCH_X, y + NODE_H + BRANCH_GAP, depth + 1)
        : { width: NODE_W, height: 0, entry: null, exit: null, right: x + BRANCH_X + NODE_W };

      const branchBottom = y + NODE_H + BRANCH_GAP + Math.max(yesLayout.height, noLayout.height, 44);
      const mergeX = x + NODE_W / 2;
      const mergeY = branchBottom + 20;

      addBadge("Yes", x + 18, y + NODE_H + 6);
      addBadge("No", x + NODE_W + 22, y + 10);

      if (yesLayout.entry) {
        addPath([
          { x: x + NODE_W / 2, y: y + NODE_H },
          { x: x + NODE_W / 2, y: y + NODE_H + 12 },
          { x: yesLayout.entry.x, y: y + NODE_H + 12 },
          yesLayout.entry
        ], "branch");
      } else {
        addPath([
          { x: x + NODE_W / 2, y: y + NODE_H },
          { x: mergeX, y: mergeY }
        ], "branch");
      }

      if (noLayout.entry) {
        addPath([
          { x: x + NODE_W, y: y + NODE_H / 2 },
          { x: noLayout.entry.x - 18, y: y + NODE_H / 2 },
          { x: noLayout.entry.x - 18, y: noLayout.entry.y },
          noLayout.entry
        ], "branch");
      } else {
        addPath([
          { x: x + NODE_W, y: y + NODE_H / 2 },
          { x: x + NODE_W + 30, y: y + NODE_H / 2 },
          { x: x + NODE_W + 30, y: mergeY },
          { x: mergeX, y: mergeY }
        ], "branch");
      }

      if (yesLayout.exit) {
        addPath([
          yesLayout.exit,
          { x: yesLayout.exit.x, y: mergeY },
          { x: mergeX, y: mergeY }
        ], "merge");
      }

      if (noLayout.exit) {
        addPath([
          noLayout.exit,
          { x: noLayout.exit.x, y: mergeY },
          { x: mergeX, y: mergeY }
        ], "merge");
      }

      return {
        height: mergeY - y,
        entry: { x: x + NODE_W / 2, y },
        exit: { x: mergeX, y: mergeY },
        right: Math.max(x + NODE_W, yesLayout.right, noLayout.right)
      };
    }

    const layout = layoutSequence(tree.root, PADDING, PADDING, 0);
    scene.width = Math.max(layout.right + PADDING, 820);
    scene.height = Math.max(layout.height + PADDING * 2, 640);
    return scene;
  }

  function renderScene(svg, scene) {
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);

    const defs = el("defs");
    const marker = el("marker", {
      id: "phase2-arrow",
      viewBox: "0 0 10 10",
      refX: "10",
      refY: "5",
      markerWidth: "8",
      markerHeight: "8",
      orient: "auto-start-reverse",
      fill: "#7ea6ff"
    });
    marker.appendChild(el("path", { d: "M 0 0 L 10 5 L 0 10 z" }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    svg.appendChild(el("rect", {
      x: 0,
      y: 0,
      width: scene.width,
      height: scene.height,
      fill: "#0f1224"
    }));

    for (const path of scene.paths) {
      const d = path.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
      svg.appendChild(el("path", {
        d,
        fill: "none",
        stroke: path.mode === "merge" ? "#50628f" : "#7ea6ff",
        "stroke-width": path.mode === "main" ? "1.8" : "1.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "marker-end": "url(#phase2-arrow)"
      }));
    }

    for (const shape of scene.shapes) {
      if (shape.type === "reference") {
        svg.appendChild(el("rect", {
          x: shape.x,
          y: shape.y,
          width: shape.w,
          height: shape.h,
          rx: 18,
          ry: 18,
          fill: "#11182d",
          stroke: "#53617f",
          "stroke-dasharray": "6 5",
          "stroke-width": "1.4"
        }));
        continue;
      }

      if (shape.type === "decision") {
        const cx = shape.x + shape.w / 2;
        const cy = shape.y + shape.h / 2;
        svg.appendChild(el("polygon", {
          points: `${cx},${shape.y} ${shape.x + shape.w},${cy} ${cx},${shape.y + shape.h} ${shape.x},${cy}`,
          fill: "#1b2440",
          stroke: "#ffb44d",
          "stroke-width": "2"
        }));
        continue;
      }

      const fill = shape.type === "start" ? "#15345d" : shape.type === "end" ? "#17162b" : "#1b2440";
      const radius = shape.type === "start" || shape.type === "end" ? 26 : 14;
      svg.appendChild(el("rect", {
        x: shape.x,
        y: shape.y,
        width: shape.w,
        height: shape.h,
        rx: radius,
        ry: radius,
        fill,
        stroke: "#6b8fd6",
        "stroke-width": shape.mode === "detail" ? "1.9" : "1.4"
      }));
    }

    for (const badge of scene.badges) {
      svg.appendChild(el("rect", {
        x: badge.x,
        y: badge.y,
        width: 38,
        height: 18,
        rx: 9,
        ry: 9,
        fill: "#0f1830",
        stroke: "#394563",
        "stroke-width": "1"
      }));
      svg.appendChild(el("text", {
        x: badge.x + 19,
        y: badge.y + 9,
        fill: badge.text === "Yes" ? "#7ddc9b" : "#ff9b9b",
        "font-size": "10",
        "font-family": "-apple-system, sans-serif",
        "text-anchor": "middle",
        "dominant-baseline": "central"
      }, badge.text));
    }

    for (const label of scene.labels) {
      svg.appendChild(el("text", {
        x: label.x,
        y: label.y,
        fill: "#e8edf9",
        "font-size": "12",
        "font-family": '"Courier New", monospace',
        "text-anchor": "middle",
        "dominant-baseline": "central"
      }, label.text));
    }
  }

  function mount(graph, mountEl) {
    mountEl.innerHTML = "";

    const tree = buildFlowTree(graph);
    const container = document.createElement("div");
    container.className = "phase2-viewer";

    const hint = document.createElement("div");
    hint.className = "phase2-hint";
    hint.textContent = "Scroll to zoom. Drag to pan. Branch detail expands as you zoom in.";

    const viewportEl = document.createElement("div");
    viewportEl.className = "phase2-viewport";
    const svg = el("svg", { xmlns: NS, class: "phase2-svg" });
    viewportEl.appendChild(svg);
    container.appendChild(hint);
    container.appendChild(viewportEl);
    mountEl.appendChild(container);

    const state = {
      zoom: 1,
      panX: 0,
      panY: 0
    };
    const sceneBounds = buildScene(tree, { zoom: 3 });

    function viewportToWorld() {
      const width = viewportEl.clientWidth || 800;
      const height = viewportEl.clientHeight || 640;
      return {
        left: (-state.panX) / state.zoom,
        top: (-state.panY) / state.zoom,
        right: (width - state.panX) / state.zoom,
        bottom: (height - state.panY) / state.zoom
      };
    }

    function syncTransform() {
      svg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
      svg.style.transformOrigin = "0 0";
      svg.style.width = `${sceneBounds.width}px`;
      svg.style.height = `${sceneBounds.height}px`;
    }

    function render() {
      syncTransform();
      const scene = buildScene(tree, {
        zoom: state.zoom,
        viewport: viewportToWorld()
      });
      renderScene(svg, scene);
    }

    function centerInitial() {
      const width = viewportEl.clientWidth || 800;
      state.panX = Math.max(0, (width - sceneBounds.width * state.zoom) / 2);
      state.panY = 24;
    }

    let drag = null;

    function onWheel(event) {
      event.preventDefault();
      const rect = viewportEl.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const worldX = (localX - state.panX) / state.zoom;
      const worldY = (localY - state.panY) / state.zoom;
      const nextZoom = clamp(state.zoom * (event.deltaY < 0 ? 1.14 : 0.88), 0.45, 3.4);
      state.panX = localX - worldX * nextZoom;
      state.panY = localY - worldY * nextZoom;
      state.zoom = nextZoom;
      render();
    }

    function onPointerDown(event) {
      drag = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      viewportEl.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event) {
      if (!drag) return;
      state.panX = drag.panX + (event.clientX - drag.x);
      state.panY = drag.panY + (event.clientY - drag.y);
      render();
    }

    function onPointerUp(event) {
      if (!drag) return;
      drag = null;
      if (viewportEl.hasPointerCapture(event.pointerId)) {
        viewportEl.releasePointerCapture(event.pointerId);
      }
    }

    function onResize() {
      if (state.panX === 0 && state.panY === 0) centerInitial();
      render();
    }

    viewportEl.addEventListener("wheel", onWheel, { passive: false });
    viewportEl.addEventListener("pointerdown", onPointerDown);
    viewportEl.addEventListener("pointermove", onPointerMove);
    viewportEl.addEventListener("pointerup", onPointerUp);
    viewportEl.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", onResize);

    centerInitial();
    render();

    return {
      refresh() {
        if (viewportEl.clientWidth > 0) {
          render();
        }
      },
      destroy() {
        viewportEl.removeEventListener("wheel", onWheel);
        viewportEl.removeEventListener("pointerdown", onPointerDown);
        viewportEl.removeEventListener("pointermove", onPointerMove);
        viewportEl.removeEventListener("pointerup", onPointerUp);
        viewportEl.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("resize", onResize);
        mountEl.innerHTML = "";
      }
    };
  }

  return {
    buildFlowTree,
    buildScene,
    getDetailDepth,
    mount
  };
});
