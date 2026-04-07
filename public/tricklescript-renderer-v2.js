(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TrickleScriptRendererV2 = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const NODE_W = 176;
  const NODE_H = 56;
  const NODE_GAP_Y = 28;
  const BRANCH_X = 228;
  const BRANCH_Y = 24;
  const BUBBLE_W = 206;
  const BUBBLE_H = 118;
  const BUBBLE_HEADER = 18;
  const PADDING = 48;
  const CULL_PAD = 220;
  const FONT_STACK = '"Courier New", monospace';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function truncateLabel(label, maxChars) {
    if (label.length <= maxChars) return label;
    return label.slice(0, maxChars - 1) + "\u2026";
  }

  function getDetailDepth(zoom) {
    if (zoom < 0.9) return 0;
    return 1 + Math.floor(Math.log2(zoom / 0.9));
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
      root: buildSequence("start", new Set(), new Set())
    };
  }

  function buildRecursiveModel(tree) {
    function buildSegment(items) {
      if (!items || !items.length) return null;
      const head = items[0];
      const rest = items.slice(1);
      const segment = {
        kind: head.kind,
        nodeId: head.nodeId,
        label: head.label || null,
        next: buildSegment(rest)
      };

      if (head.kind === "decision") {
        segment.yes = buildSegment(head.yes || []);
        segment.no = buildSegment(head.no || []);
      }

      return segment;
    }

    return buildSegment(tree.root);
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

    const root = buildRecursiveModel(tree);
    const scene = {
      width: 0,
      height: 0,
      paths: [],
      labels: [],
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

    function summarizeSegment(segment) {
      if (!segment) return "Empty";
      if (segment.kind === "reference") return truncateLabel("Loop to " + segment.label, 20);
      const node = tree.nodeMap[segment.nodeId];
      return truncateLabel(node ? node.label : "Branch", 20);
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

    function addReference(segment, x, y) {
      if (!inView(x, y, NODE_W, NODE_H - 12)) return;
      scene.nodes.push({
        id: segment.nodeId,
        type: "reference",
        label: "Loop to " + segment.label,
        x,
        y,
        w: NODE_W,
        h: NODE_H - 12,
        mode: "summary"
      });
      scene.labels.push({
        text: "Loop to " + segment.label,
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

    function addBubble(bubble) {
      if (!inView(bubble.x, bubble.y, bubble.w, bubble.h)) return;
      scene.bubbles.push(bubble);
    }

    function layoutSegment(segment, x, y, depth) {
      if (!segment) {
        return { bottom: y, right: x, entry: null, exit: null };
      }

      if (segment.kind === "reference") {
        addReference(segment, x, y + 6);
        return {
          bottom: y + NODE_H - 6,
          right: x + NODE_W,
          entry: { x: x + NODE_W / 2, y: y + 6 },
          exit: { x: x + NODE_W / 2, y: y + NODE_H - 6 }
        };
      }

      addNode(segment.nodeId, x, y, depth > 0 ? "detail" : "summary");
      const nodeBottom = y + NODE_H;
      let bottom = nodeBottom;
      let right = x + NODE_W;
      let exit = { x: x + NODE_W / 2, y: nodeBottom };

      if (segment.kind === "decision") {
        const yesBubble = {
          x: x + BRANCH_X,
          y: y - 2,
          w: BUBBLE_W,
          h: BUBBLE_H,
          label: "Yes",
          direction: "right",
          expanded: depth < depthLimit,
          summary: summarizeSegment(segment.yes)
        };
        const noBubble = {
          x,
          y: y + NODE_H + BRANCH_Y,
          w: BUBBLE_W,
          h: BUBBLE_H,
          label: "No",
          direction: "down",
          expanded: depth < depthLimit,
          summary: summarizeSegment(segment.no)
        };

        addBubble(yesBubble);
        addBubble(noBubble);

        addPath([
          { x: x + NODE_W, y: y + NODE_H / 2 },
          { x: yesBubble.x, y: yesBubble.y + yesBubble.h / 2 }
        ], "branch");
        addPath([
          { x: x + NODE_W / 2, y: nodeBottom },
          { x: x + NODE_W / 2, y: noBubble.y },
          { x: noBubble.x + noBubble.w / 2, y: noBubble.y }
        ], "branch");

        if (depth < depthLimit) {
          const yesInner = layoutSegment(segment.yes, yesBubble.x + (yesBubble.w - NODE_W) / 2, yesBubble.y + BUBBLE_HEADER + 18, depth + 1);
          const noInner = layoutSegment(segment.no, noBubble.x + (noBubble.w - NODE_W) / 2, noBubble.y + BUBBLE_HEADER + 18, depth + 1);
          right = Math.max(right, yesInner.right, noInner.right, yesBubble.x + yesBubble.w, noBubble.x + noBubble.w);
          bottom = Math.max(bottom, yesInner.bottom, noInner.bottom, yesBubble.y + yesBubble.h, noBubble.y + noBubble.h);
        } else {
          right = Math.max(right, yesBubble.x + yesBubble.w, noBubble.x + noBubble.w);
          bottom = Math.max(bottom, yesBubble.y + yesBubble.h, noBubble.y + noBubble.h);
        }

        const mergeY = bottom + 24;
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

        bottom = mergeY;
        exit = { x: mergeX, y: mergeY };
      }

      if (segment.next) {
        const nextBubble = {
          x,
          y: bottom + NODE_GAP_Y,
          w: BUBBLE_W,
          h: BUBBLE_H,
          label: "Next",
          direction: "down",
          expanded: depth < depthLimit,
          summary: summarizeSegment(segment.next)
        };
        addBubble(nextBubble);
        addPath([
          exit,
          { x: exit.x, y: nextBubble.y },
          { x: nextBubble.x + nextBubble.w / 2, y: nextBubble.y }
        ], "main");

        if (depth < depthLimit) {
          const nextInner = layoutSegment(segment.next, nextBubble.x + (nextBubble.w - NODE_W) / 2, nextBubble.y + BUBBLE_HEADER + 18, depth + 1);
          right = Math.max(right, nextInner.right, nextBubble.x + nextBubble.w);
          bottom = Math.max(nextInner.bottom, nextBubble.y + nextBubble.h);
        } else {
          right = Math.max(right, nextBubble.x + nextBubble.w);
          bottom = Math.max(bottom, nextBubble.y + nextBubble.h);
        }
        exit = { x: nextBubble.x + nextBubble.w / 2, y: bottom };
      }

      return {
        bottom,
        right,
        entry: { x: x + NODE_W / 2, y },
        exit
      };
    }

    const layout = layoutSegment(root, PADDING, PADDING, 0);
    scene.width = Math.max(layout.right + PADDING, 860);
    scene.height = Math.max(layout.bottom + PADDING, 680);
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

  function projectX(camera, x) {
    return camera.panX + x * camera.zoom;
  }

  function projectY(camera, y) {
    return camera.panY + y * camera.zoom;
  }

  function projectL(camera, length) {
    return length * camera.zoom;
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

    ctx.fillStyle = "rgba(126, 166, 255, 0.06)";
    ctx.beginPath();
    ctx.arc(projectX(camera, scene.width * 0.45), projectY(camera, 48), projectL(camera, 260), 0, Math.PI * 2);
    ctx.fill();

    for (const path of scene.paths) {
      const color = path.mode === "merge" ? "#4c5d85" : "#7ea6ff";
      ctx.strokeStyle = color;
      ctx.lineWidth = path.mode === "main" ? 1.8 : 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      path.points.forEach((point, index) => {
        const px = projectX(camera, point.x);
        const py = projectY(camera, point.y);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      if (path.points.length > 1) {
        drawArrowHead(ctx, {
          x: projectX(camera, path.points[path.points.length - 2].x),
          y: projectY(camera, path.points[path.points.length - 2].y)
        }, {
          x: projectX(camera, path.points[path.points.length - 1].x),
          y: projectY(camera, path.points[path.points.length - 1].y)
        }, color);
      }
    }

    for (const bubble of scene.bubbles) {
      const x = projectX(camera, bubble.x);
      const y = projectY(camera, bubble.y);
      const w = projectL(camera, bubble.w);
      const h = projectL(camera, bubble.h);
      drawRoundedRect(ctx, x, y, w, h, Math.max(8, projectL(camera, 18)));
      ctx.fillStyle = bubble.expanded ? "rgba(18, 26, 48, 0.9)" : "rgba(12, 18, 34, 0.95)";
      ctx.strokeStyle = bubble.label === "Yes" ? "#6fd6a0" : bubble.label === "No" ? "#ff9f9f" : "#8aa4ff";
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();

      const pillX = x + projectL(camera, 8);
      const pillY = y + projectL(camera, 4);
      const pillW = Math.min(w - projectL(camera, 16), projectL(camera, 94));
      const pillH = projectL(camera, BUBBLE_HEADER);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      drawRoundedRect(ctx, pillX, pillY, pillW, pillH, Math.max(5, projectL(camera, 7)));
      ctx.fill();

      ctx.font = `10px ${FONT_STACK}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = bubble.label === "Yes" ? "#8df0b3" : bubble.label === "No" ? "#ffb1b1" : "#b4c2ff";
      ctx.fillText(bubble.label, pillX + 8, pillY + pillH / 2);

      if (!bubble.expanded) {
        ctx.font = `10px ${FONT_STACK}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#d8e2ff";
        ctx.fillText(bubble.summary, x + w / 2, y + h / 2 + 4);
      }
    }

    for (const node of scene.nodes) {
      const x = projectX(camera, node.x);
      const y = projectY(camera, node.y);
      const w = projectL(camera, node.w);
      const h = projectL(camera, node.h);
      if (node.type === "decision") {
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x + w, cy);
        ctx.lineTo(cx, y + h);
        ctx.lineTo(x, cy);
        ctx.closePath();
        ctx.fillStyle = "#1b2440";
        ctx.strokeStyle = "#ffb44d";
        ctx.lineWidth = 1.6;
        ctx.fill();
        ctx.stroke();
        continue;
      }

      if (node.type === "reference") {
        drawRoundedRect(ctx, x, y, w, h, Math.max(8, projectL(camera, 18)));
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
      const radius = node.type === "start" || node.type === "end" ? 26 : 14;
      drawRoundedRect(ctx, x, y, w, h, Math.max(8, projectL(camera, radius)));
      ctx.fillStyle = fill;
      ctx.strokeStyle = "#6b8fd6";
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
    }

    ctx.font = `10px ${FONT_STACK}`;
    ctx.fillStyle = "#e8edf9";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of scene.labels) {
      ctx.fillText(label.text, projectX(camera, label.x), projectY(camera, label.y));
    }
    ctx.restore();
  }

  function mount(graph, mountEl) {
    mountEl.innerHTML = "";

    const tree = buildFlowTree(graph);
    const container = document.createElement("div");
    container.className = "phase2-viewer";

    const hint = document.createElement("div");
    hint.className = "phase2-hint";
    hint.textContent = "Scroll to zoom. Drag to pan. Deeper zoom reveals nested next/yes/no bubbles.";

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
      zoom: 1.8,
      panX: 0,
      panY: 24,
      dpr: 1
    };

    const maxScene = buildScene(tree, { zoom: 18 });
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
      state.panX = Math.max(0, (width - maxScene.width * Math.min(state.zoom, 1)) / 2);
      state.panY = 24;
    }

    function onWheel(event) {
      event.preventDefault();
      const rect = viewportEl.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const worldX = (localX - state.panX) / state.zoom;
      const worldY = (localY - state.panY) / state.zoom;
      const nextZoom = Math.max(0.45, state.zoom * (event.deltaY < 0 ? 1.16 : 0.86));
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
    buildRecursiveModel,
    buildScene,
    getDetailDepth,
    mount
  };
});
