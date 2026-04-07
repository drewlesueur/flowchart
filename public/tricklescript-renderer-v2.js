(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TrickleScriptRendererV2 = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const NODE_W = 176;
  const NODE_H = 56;
  const GAP_Y = 34;
  const BRANCH_GAP = 24;
  const BRANCH_X = 264;
  const BUBBLE_MIN_W = 208;
  const BUBBLE_MIN_H = 120;
  const BUBBLE_PAD = 22;
  const PADDING = 48;
  const CULL_PAD = 220;
  const FONT_STACK = '"Courier New", monospace';
  const UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
      edgeMap[edge.from].push(edge);
      adjacency[edge.from].push(edge.to);
    }

    function unlabeledTarget(nodeId) {
      const edge = edgeMap[nodeId].find((candidate) => !candidate.label);
      return edge ? edge.to : null;
    }

    function branchTarget(nodeId, label) {
      const edge = edgeMap[nodeId].find((candidate) => candidate.label === label);
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
        if (!current || current.id == null || distances.has(current.id)) continue;
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
      candidates.sort((a, b) => (a.score - b.score) || (a.rank - b.rank));
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
      paths: [],
      labels: [],
      badges: [],
      bubbles: [],
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

    function addNode(nodeId, x, y, mode) {
      const node = tree.nodeMap[nodeId];
      if (!node || !inView(x, y, NODE_W, NODE_H)) return;
      scene.nodes.push({
        id: nodeId,
        type: node.type,
        label: truncateLabel(node.label, mode === "detail" ? 28 : 22),
        x,
        y,
        w: NODE_W,
        h: NODE_H,
        mode
      });
      scene.labels.push({
        text: truncateLabel(node.label, mode === "detail" ? 28 : 22),
        x: x + NODE_W / 2,
        y: y + NODE_H / 2,
        kind: "node"
      });
    }

    function addReference(item, x, y) {
      if (!inView(x, y, NODE_W, NODE_H - 12)) return;
      scene.nodes.push({
        id: item.nodeId,
        type: "reference",
        label: "Loop to " + item.label,
        x,
        y,
        w: NODE_W,
        h: NODE_H - 12,
        mode: "summary"
      });
      scene.labels.push({
        text: "Loop to " + item.label,
        x: x + NODE_W / 2,
        y: y + (NODE_H - 12) / 2,
        kind: "reference"
      });
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
      if (!inView(x, y, 40, 18)) return;
      scene.badges.push({ text, x, y });
    }

    function addBubble(x, y, width, height, label, direction, expanded, summary) {
      if (!inView(x, y, width, height)) return;
      scene.bubbles.push({ x, y, w: width, h: height, label, direction, expanded, summary });
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
        addNode(item.nodeId, x, y, depth > 0 ? "detail" : "summary");
        return {
          height: NODE_H,
          entry: { x: x + NODE_W / 2, y },
          exit: { x: x + NODE_W / 2, y: y + NODE_H },
          right: x + NODE_W
        };
      }

      addNode(item.nodeId, x, y, depth > 0 ? "detail" : "summary");
      const expandBranches = depth < depthLimit;
      const yesInner = expandBranches && item.yes.length
        ? layoutSequence(item.yes, x + BRANCH_X + BUBBLE_PAD, y + BUBBLE_PAD, depth + 1)
        : null;
      const noInner = expandBranches && item.no.length
        ? layoutSequence(item.no, x + BUBBLE_PAD, y + NODE_H + BRANCH_GAP + BUBBLE_PAD, depth + 1)
        : null;

      const yesBubble = {
        x: x + BRANCH_X,
        y,
        w: Math.max(BUBBLE_MIN_W, yesInner ? yesInner.width + BUBBLE_PAD * 2 : BUBBLE_MIN_W),
        h: Math.max(BUBBLE_MIN_H, yesInner ? yesInner.height + BUBBLE_PAD * 2 : BUBBLE_MIN_H)
      };
      const noBubble = {
        x,
        y: y + NODE_H + BRANCH_GAP,
        w: Math.max(BUBBLE_MIN_W, noInner ? noInner.width + BUBBLE_PAD * 2 : BUBBLE_MIN_W),
        h: Math.max(BUBBLE_MIN_H, noInner ? noInner.height + BUBBLE_PAD * 2 : BUBBLE_MIN_H)
      };

      addBubble(
        yesBubble.x,
        yesBubble.y,
        yesBubble.w,
        yesBubble.h,
        "Yes",
        "right",
        expandBranches,
        item.yes[0] ? truncateLabel(tree.nodeMap[item.yes[0].nodeId || item.yes[0].label]?.label || item.yes[0].label || "Branch", 20) : "Empty"
      );
      addBubble(
        noBubble.x,
        noBubble.y,
        noBubble.w,
        noBubble.h,
        "No",
        "down",
        expandBranches,
        item.no[0] ? truncateLabel(tree.nodeMap[item.no[0].nodeId || item.no[0].label]?.label || item.no[0].label || "Branch", 20) : "Empty"
      );

      addPath([
        { x: x + NODE_W, y: y + NODE_H / 2 },
        { x: yesBubble.x, y: yesBubble.y + yesBubble.h / 2 }
      ], "branch");
      addPath([
        { x: x + NODE_W / 2, y: y + NODE_H },
        { x: x + NODE_W / 2, y: noBubble.y },
        { x: noBubble.x + noBubble.w / 2, y: noBubble.y }
      ], "branch");

      const mergeY = noBubble.y + noBubble.h + 28;
      const mergeX = x + NODE_W / 2;

      addPath([
        { x: yesBubble.x + yesBubble.w / 2, y: yesBubble.y + yesBubble.h },
        { x: yesBubble.x + yesBubble.w / 2, y: mergeY },
        { x: mergeX, y: mergeY }
      ], "merge");
      addPath([
        { x: noBubble.x + noBubble.w / 2, y: noBubble.y + noBubble.h },
        { x: noBubble.x + noBubble.w / 2, y: mergeY },
        { x: mergeX, y: mergeY }
      ], "merge");

      return {
        height: mergeY - y,
        entry: { x: x + NODE_W / 2, y },
        exit: { x: mergeX, y: mergeY },
        right: Math.max(x + NODE_W, yesBubble.x + yesBubble.w, noBubble.x + noBubble.w)
      };
    }

    const layout = layoutSequence(tree.root, PADDING, PADDING, 0);
    scene.width = Math.max(layout.right + PADDING, 820);
    scene.height = Math.max(layout.height + PADDING * 2, 640);
    return scene;
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawArrowHead(ctx, from, to, color) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - Math.cos(angle - Math.PI / 6) * size, to.y - Math.sin(angle - Math.PI / 6) * size);
    ctx.lineTo(to.x - Math.cos(angle + Math.PI / 6) * size, to.y - Math.sin(angle + Math.PI / 6) * size);
    ctx.closePath();
    ctx.fill();
  }

  function drawScene(ctx, scene, camera, viewportWidth, viewportHeight) {
    const dpr = camera.dpr || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    const gradient = ctx.createLinearGradient(0, 0, 0, viewportHeight);
    gradient.addColorStop(0, "#131935");
    gradient.addColorStop(1, "#090d1a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.save();
    ctx.translate(camera.panX, camera.panY);
    ctx.scale(camera.zoom, camera.zoom);

    ctx.fillStyle = "rgba(126, 166, 255, 0.06)";
    ctx.beginPath();
    ctx.arc(scene.width * 0.45, 48, 260, 0, Math.PI * 2);
    ctx.fill();

    for (const path of scene.paths) {
      const color = path.mode === "merge" ? "#4c5d85" : "#7ea6ff";
      ctx.strokeStyle = color;
      ctx.lineWidth = path.mode === "main" ? 1.8 : 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      path.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      if (path.points.length > 1) {
        drawArrowHead(ctx, path.points[path.points.length - 2], path.points[path.points.length - 1], color);
      }
    }

    for (const bubble of scene.bubbles) {
      drawRoundedRect(ctx, bubble.x, bubble.y, bubble.w, bubble.h, 24);
      ctx.fillStyle = bubble.expanded ? "rgba(23, 34, 60, 0.82)" : "rgba(16, 24, 45, 0.92)";
      ctx.strokeStyle = bubble.label === "Yes" ? "#6fd6a0" : "#ff9f9f";
      ctx.lineWidth = bubble.expanded ? 2 : 1.6;
      ctx.fill();
      ctx.stroke();

      ctx.font = `11px ${UI_FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = bubble.label === "Yes" ? "#8df0b3" : "#ffb1b1";
      ctx.fillText(bubble.label, bubble.x + 14, bubble.y + 10);

      ctx.font = `12px ${FONT_STACK}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = bubble.expanded ? "#9ab0dd" : "#d8e2ff";
      ctx.fillText(
        bubble.expanded ? "Zoomed in" : bubble.summary,
        bubble.x + bubble.w / 2,
        bubble.expanded ? bubble.y + 18 : bubble.y + bubble.h / 2
      );
    }

    for (const node of scene.nodes) {
      if (node.type === "decision") {
        const cx = node.x + node.w / 2;
        const cy = node.y + node.h / 2;
        ctx.beginPath();
        ctx.moveTo(cx, node.y);
        ctx.lineTo(node.x + node.w, cy);
        ctx.lineTo(cx, node.y + node.h);
        ctx.lineTo(node.x, cy);
        ctx.closePath();
        ctx.fillStyle = "#1b2440";
        ctx.strokeStyle = "#ffb44d";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        continue;
      }

      if (node.type === "reference") {
        drawRoundedRect(ctx, node.x, node.y, node.w, node.h, 18);
        ctx.fillStyle = "#11182d";
        ctx.strokeStyle = "#53617f";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 5]);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }

      const fill = node.type === "start" ? "#15345d" : node.type === "end" ? "#17162b" : "#1b2440";
      const radius = (node.type === "start" || node.type === "end") ? 26 : 14;
      drawRoundedRect(ctx, node.x, node.y, node.w, node.h, radius);
      ctx.fillStyle = fill;
      ctx.strokeStyle = "#6b8fd6";
      ctx.lineWidth = node.mode === "detail" ? 1.9 : 1.4;
      ctx.fill();
      ctx.stroke();
    }

    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillStyle = "#e8edf9";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of scene.labels) {
      ctx.fillText(label.text, label.x, label.y);
    }

    ctx.restore();
    ctx.restore();
  }

  function mount(graph, mountEl) {
    mountEl.innerHTML = "";

    const tree = buildFlowTree(graph);
    const container = document.createElement("div");
    container.className = "phase2-viewer";

    const hint = document.createElement("div");
    hint.className = "phase2-hint";
    hint.textContent = "Canvas explorer. Scroll to zoom. Drag to pan. Nested branches open as you zoom in.";

    const viewportEl = document.createElement("div");
    viewportEl.className = "phase2-viewport";

    const canvas = document.createElement("canvas");
    canvas.className = "phase2-canvas";
    viewportEl.appendChild(canvas);
    container.appendChild(hint);
    container.appendChild(viewportEl);
    mountEl.appendChild(container);

    const ctx = canvas.getContext("2d");
    const state = {
      zoom: 1,
      panX: 0,
      panY: 24,
      dpr: 1
    };

    const maxScene = buildScene(tree, { zoom: 3 });
    let rafId = 0;
    let drag = null;
    let resizeObserver = null;

    function viewportToWorld(width, height) {
      return {
        left: (-state.panX) / state.zoom,
        top: (-state.panY) / state.zoom,
        right: (width - state.panX) / state.zoom,
        bottom: (height - state.panY) / state.zoom
      };
    }

    function ensureCanvasSize() {
      const width = viewportEl.clientWidth || 800;
      const height = viewportEl.clientHeight || 640;
      state.dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * state.dpr);
      canvas.height = Math.floor(height * state.dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      return { width, height };
    }

    function scheduleDraw() {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        draw();
      });
    }

    function draw() {
      const { width, height } = ensureCanvasSize();
      const scene = buildScene(tree, {
        zoom: state.zoom,
        viewport: viewportToWorld(width, height)
      });
      drawScene(ctx, scene, state, width, height);
    }

    function centerInitial() {
      const width = viewportEl.clientWidth || 800;
      state.panX = Math.max(0, (width - maxScene.width * state.zoom) / 2);
      state.panY = 24;
    }

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
      scheduleDraw();
    }

    function onPointerDown(event) {
      drag = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      viewportEl.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event) {
      if (!drag) return;
      state.panX = drag.panX + (event.clientX - drag.x);
      state.panY = drag.panY + (event.clientY - drag.y);
      scheduleDraw();
    }

    function onPointerUp(event) {
      if (!drag) return;
      drag = null;
      if (viewportEl.hasPointerCapture(event.pointerId)) {
        viewportEl.releasePointerCapture(event.pointerId);
      }
    }

    function onResize() {
      scheduleDraw();
    }

    viewportEl.addEventListener("wheel", onWheel, { passive: false });
    viewportEl.addEventListener("pointerdown", onPointerDown);
    viewportEl.addEventListener("pointermove", onPointerMove);
    viewportEl.addEventListener("pointerup", onPointerUp);
    viewportEl.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", onResize);

    if (typeof window.ResizeObserver === "function") {
      resizeObserver = new window.ResizeObserver(() => scheduleDraw());
      resizeObserver.observe(viewportEl);
    }

    centerInitial();
    scheduleDraw();

    return {
      refresh() {
        scheduleDraw();
      },
      destroy() {
        if (rafId) window.cancelAnimationFrame(rafId);
        viewportEl.removeEventListener("wheel", onWheel);
        viewportEl.removeEventListener("pointerdown", onPointerDown);
        viewportEl.removeEventListener("pointermove", onPointerMove);
        viewportEl.removeEventListener("pointerup", onPointerUp);
        viewportEl.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("resize", onResize);
        if (resizeObserver) resizeObserver.disconnect();
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
