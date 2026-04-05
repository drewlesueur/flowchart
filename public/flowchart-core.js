(function () {
  const SAMPLE_CODE = `function classifyOrder(order) {
  if (!order.paid) {
    return "hold";
  }

  if (order.total > 1000) {
    approve(order);
  } else {
    review(order);
  }

  for (const item of order.items) {
    if (item.backordered) {
      notifyCustomer(item);
    }
  }

  ship(order);
  return "done";
}`;

  const STYLE = {
    branchGap: 88,
    cornerRadius: 18,
    decisionHeight: 84,
    emptyBranchWidth: 120,
    gapY: 44,
    horizontalPadding: 34,
    loopReturnOffset: 76,
    margin: 48,
    textLineHeight: 18,
  };

  const CHART_COLORS = {
    edge: "#5f4637",
    edgeLabel: "#5f4637",
    end: "#f7d7b7",
    process: "#fffaf1",
    decision: "#ffe5cd",
    group: "#f8ecde",
    start: "#ffd2a8",
    stroke: "#6b4227",
    terminal: "#ffdcca",
    text: "#2d2119",
  };

  function debounce(fn, wait) {
    let timeoutId = 0;
    return (...args) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function stripComments(code) {
    let result = "";
    let i = 0;
    let state = "normal";
    let quote = "";

    while (i < code.length) {
      const char = code[i];
      const next = code[i + 1];

      if (state === "line-comment") {
        if (char === "\n") {
          state = "normal";
          result += "\n";
        }
        i += 1;
        continue;
      }

      if (state === "block-comment") {
        if (char === "*" && next === "/") {
          state = "normal";
          i += 2;
          continue;
        }

        if (char === "\n") {
          result += "\n";
        }

        i += 1;
        continue;
      }

      if (state === "string") {
        result += char;

        if (char === "\\") {
          result += next || "";
          i += 2;
          continue;
        }

        if (char === quote) {
          state = "normal";
          quote = "";
        }

        i += 1;
        continue;
      }

      if (char === "/" && next === "/") {
        state = "line-comment";
        i += 2;
        continue;
      }

      if (char === "/" && next === "*") {
        state = "block-comment";
        i += 2;
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        state = "string";
        quote = char;
        result += char;
        i += 1;
        continue;
      }

      result += char;
      i += 1;
    }

    return result;
  }

  function tokenize(code) {
    const source = stripComments(code);
    const tokens = [];
    let buffer = "";
    let parenDepth = 0;
    let bracketDepth = 0;
    let state = "normal";
    let quote = "";

    function flushText() {
      const text = buffer.trim();
      if (text) {
        tokens.push({ type: "text", value: text });
      }
      buffer = "";
    }

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const next = source[i + 1];

      if (state === "string") {
        buffer += char;

        if (char === "\\") {
          buffer += next || "";
          i += 1;
          continue;
        }

        if (char === quote) {
          state = "normal";
          quote = "";
        }

        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        state = "string";
        quote = char;
        buffer += char;
        continue;
      }

      if (char === "(") {
        parenDepth += 1;
        buffer += char;
        continue;
      }

      if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        buffer += char;
        continue;
      }

      if (char === "[") {
        bracketDepth += 1;
        buffer += char;
        continue;
      }

      if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
        buffer += char;
        continue;
      }

      if (parenDepth === 0 && bracketDepth === 0 && (char === "{" || char === "}" || char === ";")) {
        flushText();
        tokens.push({ type: char });
        continue;
      }

      if (parenDepth === 0 && bracketDepth === 0 && char === "\n") {
        flushText();
        tokens.push({ type: "newline" });
        continue;
      }

      buffer += char;
    }

    flushText();
    return tokens;
  }

  function extractCondition(header, keyword) {
    const trimmed = header.trim();
    const withoutKeyword = trimmed.slice(keyword.length).trim();
    const start = withoutKeyword.indexOf("(");
    const end = withoutKeyword.lastIndexOf(")");

    if (start !== -1 && end !== -1 && end > start) {
      return withoutKeyword.slice(start + 1, end).trim() || trimmed;
    }

    return withoutKeyword || trimmed;
  }

  function isTerminalText(text) {
    return /^(return|throw|break|continue)\b/.test(text);
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function parseCode(code) {
    const tokens = tokenize(code);
    let index = 0;

    function peek(offset = 0) {
      return tokens[index + offset] || null;
    }

    function consume() {
      const token = tokens[index] || null;
      index += 1;
      return token;
    }

    function skipNewlines() {
      while (peek() && peek().type === "newline") {
        consume();
      }
    }

    function parseBlockItems() {
      const items = [];

      while (index < tokens.length) {
        skipNewlines();

        if (!peek() || peek().type === "}") {
          break;
        }

        const statement = parseStatement();
        if (statement) {
          items.push(statement);
        } else if (peek() && peek().type !== "}") {
          consume();
        }
      }

      return items;
    }

    function parseInlineBody() {
      skipNewlines();

      if (peek() && peek().type === "{") {
        consume();
        const items = parseBlockItems();
        if (peek() && peek().type === "}") {
          consume();
        }
        return items;
      }

      const statement = parseStatement();
      return statement ? [statement] : [];
    }

    function parseElseBranch() {
      skipNewlines();
      const next = peek();

      if (!next || next.type !== "text" || !/^else\b/.test(next.value)) {
        return [];
      }

      const text = normalizeText(consume().value);

      if (/^else\s+if\b/.test(text)) {
        return [parseIfHeader(text.replace(/^else\s+/, ""))];
      }

      if (peek() && peek().type === "{") {
        consume();
        const items = parseBlockItems();
        if (peek() && peek().type === "}") {
          consume();
        }
        return items;
      }

      const statement = parseStatement();
      return statement ? [statement] : [];
    }

    function parseIfHeader(headerText) {
      const thenBranch = parseInlineBody();
      const elseBranch = parseElseBranch();

      return {
        type: "decision",
        text: extractCondition(headerText, "if"),
        thenBranch,
        elseBranch,
      };
    }

    function parseLoopHeader(headerText, keyword) {
      return {
        type: "loop",
        text: extractCondition(headerText, keyword),
        keyword,
        body: parseInlineBody(),
      };
    }

    function parseGroupHeader(headerText) {
      const label = normalizeText(headerText);
      const body = parseInlineBody();
      return {
        type: "group",
        text: label,
        body,
      };
    }

    function parseStatement() {
      skipNewlines();
      const token = peek();

      if (!token) {
        return null;
      }

      if (token.type === "{") {
        consume();
        const items = parseBlockItems();
        if (peek() && peek().type === "}") {
          consume();
        }
        return {
          type: "group",
          text: "block",
          body: items,
        };
      }

      if (token.type !== "text") {
        return null;
      }

      const text = normalizeText(consume().value);

      if (peek() && peek().type === ";") {
        consume();
      }

      if (/^if\b/.test(text)) {
        return parseIfHeader(text);
      }

      if (/^for\b/.test(text)) {
        return parseLoopHeader(text, "for");
      }

      if (/^while\b/.test(text)) {
        return parseLoopHeader(text, "while");
      }

      if (/^(function|async function|class)\b/.test(text) || /=>\s*$/.test(text)) {
        return parseGroupHeader(text);
      }

      if (peek() && peek().type === "{") {
        return parseGroupHeader(text);
      }

      return {
        type: isTerminalText(text) ? "terminal" : "process",
        text,
      };
    }

    return parseBlockItems();
  }

  function wrapText(text, maxLineLength = 24) {
    const words = normalizeText(text).split(" ").filter(Boolean);
    if (!words.length) {
      return [""];
    }

    const lines = [];
    let current = words[0];

    for (let i = 1; i < words.length; i += 1) {
      const word = words[i];
      if ((current + " " + word).length <= maxLineLength) {
        current += " " + word;
      } else {
        lines.push(current);
        current = word;
      }
    }

    lines.push(current);
    return lines;
  }

  function measureNode(text, kind) {
    const lines = wrapText(text, kind === "decision" ? 18 : 24);
    const maxCharacters = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
    const width = Math.max(kind === "decision" ? 148 : 132, maxCharacters * 7.2 + STYLE.horizontalPadding * 2);
    const height = Math.max(
      kind === "decision" ? STYLE.decisionHeight : 54,
      lines.length * STYLE.textLineHeight + 28
    );

    return { width, height, lines };
  }

  function measureItems(items) {
    if (!items.length) {
      return { width: 0, height: 0 };
    }

    let width = 0;
    let height = 0;

    for (let i = 0; i < items.length; i += 1) {
      const size = measureStatement(items[i]);
      width = Math.max(width, size.width);
      height += size.height;
      if (i < items.length - 1) {
        height += STYLE.gapY;
      }
    }

    return { width, height };
  }

  function measureStatement(statement) {
    if (statement.type === "decision") {
      const node = measureNode(statement.text, "decision");
      const thenSize = measureItems(statement.thenBranch);
      const elseSize = measureItems(statement.elseBranch);
      const leftWidth = Math.max(thenSize.width, STYLE.emptyBranchWidth);
      const rightWidth = Math.max(elseSize.width, STYLE.emptyBranchWidth);
      return {
        width: Math.max(node.width, leftWidth + rightWidth + STYLE.branchGap),
        height: node.height + STYLE.gapY + Math.max(thenSize.height, elseSize.height) + STYLE.gapY / 2,
      };
    }

    if (statement.type === "loop") {
      const node = measureNode(statement.text, "decision");
      const bodySize = measureItems(statement.body);
      return {
        width: Math.max(node.width + STYLE.loopReturnOffset * 2, bodySize.width + 24),
        height: node.height + STYLE.gapY + bodySize.height + STYLE.gapY / 2,
      };
    }

    if (statement.type === "group") {
      const node = measureNode(statement.text, "group");
      const bodySize = measureItems(statement.body);
      return {
        width: Math.max(node.width, bodySize.width),
        height: node.height + (bodySize.height ? STYLE.gapY + bodySize.height : 0),
      };
    }

    const node = measureNode(statement.text, statement.type === "terminal" ? "terminal" : "process");
    return { width: node.width, height: node.height };
  }

  function createEdge(points, label = "") {
    return { points, label };
  }

  function createModel() {
    return {
      nodes: [],
      edges: [],
      nextId: 1,
      maxX: 0,
      maxY: 0,
      minX: 0,
    };
  }

  function addNode(model, type, text, cx, y) {
    const kind = type === "decision" ? "decision" : type;
    const size = measureNode(text, kind);
    const node = {
      id: `n${model.nextId}`,
      type,
      text,
      lines: size.lines,
      width: size.width,
      height: size.height,
      x: cx - size.width / 2,
      y,
    };

    model.nextId += 1;
    model.nodes.push(node);
    model.maxX = Math.max(model.maxX, node.x + node.width);
    model.maxY = Math.max(model.maxY, node.y + node.height);
    model.minX = Math.min(model.minX, node.x);
    return node;
  }

  function port(node, name) {
    if (node.type === "decision") {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      if (name === "top") {
        return { x: cx, y: node.y };
      }
      if (name === "bottom") {
        return { x: cx, y: node.y + node.height };
      }
      if (name === "left") {
        return { x: node.x, y: cy };
      }
      return { x: node.x + node.width, y: cy };
    }

    if (name === "top") {
      return { x: node.x + node.width / 2, y: node.y };
    }

    return { x: node.x + node.width / 2, y: node.y + node.height };
  }

  function connectVertical(model, from, to, label = "") {
    model.edges.push(createEdge([from, to], label));
  }

  function connectOrthogonal(model, from, to, viaX, label = "") {
    model.edges.push(
      createEdge(
        [
          from,
          { x: viaX, y: from.y },
          { x: viaX, y: to.y },
          to,
        ],
        label
      )
    );
  }

  function layoutItems(model, items, cx, topY) {
    if (!items.length) {
      return {
        entry: null,
        exit: { x: cx, y: topY },
        open: true,
        bottom: topY,
      };
    }

    let firstEntry = null;
    let prevExit = null;
    let currentY = topY;
    let bottom = topY;

    for (const item of items) {
      const layout = layoutStatement(model, item, cx, currentY);

      if (!firstEntry && layout.entry) {
        firstEntry = layout.entry;
      }

      if (prevExit && layout.entry) {
        connectVertical(model, prevExit, layout.entry);
      }

      prevExit = layout.open ? layout.exit : null;
      bottom = layout.bottom;
      currentY = layout.bottom + STYLE.gapY;
    }

    return {
      entry: firstEntry,
      exit: prevExit || null,
      open: Boolean(prevExit),
      bottom,
    };
  }

  function layoutDecision(model, statement, cx, topY) {
    const node = addNode(model, "decision", statement.text, cx, topY);
    const thenSize = measureItems(statement.thenBranch);
    const elseSize = measureItems(statement.elseBranch);
    const leftWidth = Math.max(thenSize.width, STYLE.emptyBranchWidth);
    const rightWidth = Math.max(elseSize.width, STYLE.emptyBranchWidth);
    const thenCenter = cx - (STYLE.branchGap / 2 + rightWidth / 2);
    const elseCenter = cx + (STYLE.branchGap / 2 + leftWidth / 2);
    const branchTop = node.y + node.height + STYLE.gapY;
    const thenLayout = layoutItems(model, statement.thenBranch, thenCenter, branchTop);
    const elseLayout = layoutItems(model, statement.elseBranch, elseCenter, branchTop);
    const thenBottom = statement.thenBranch.length ? thenLayout.bottom : branchTop;
    const elseBottom = statement.elseBranch.length ? elseLayout.bottom : branchTop;
    const mergeY = Math.max(thenBottom, elseBottom) + STYLE.gapY / 2;
    const leftPort = port(node, "left");
    const rightPort = port(node, "right");

    if (thenLayout.entry) {
      connectOrthogonal(model, leftPort, thenLayout.entry, thenLayout.entry.x, "yes");
    } else {
      model.edges.push(
        createEdge(
          [
            leftPort,
            { x: leftPort.x - 26, y: leftPort.y },
            { x: leftPort.x - 26, y: mergeY },
            { x: cx, y: mergeY },
          ],
          "yes"
        )
      );
    }

    if (elseLayout.entry) {
      connectOrthogonal(model, rightPort, elseLayout.entry, elseLayout.entry.x, statement.elseBranch.length ? "no" : "");
    } else {
      model.edges.push(
        createEdge(
          [
            rightPort,
            { x: rightPort.x + 26, y: rightPort.y },
            { x: rightPort.x + 26, y: mergeY },
            { x: cx, y: mergeY },
          ],
          statement.elseBranch.length ? "no" : ""
        )
      );
    }

    if (thenLayout.open && thenLayout.exit) {
      connectOrthogonal(model, thenLayout.exit, { x: cx, y: mergeY }, thenLayout.exit.x);
    }

    if (elseLayout.open && elseLayout.exit) {
      connectOrthogonal(model, elseLayout.exit, { x: cx, y: mergeY }, elseLayout.exit.x);
    }

    const open = thenLayout.open || elseLayout.open || (!statement.thenBranch.length && !statement.elseBranch.length);

    return {
      entry: port(node, "top"),
      exit: open ? { x: cx, y: mergeY } : null,
      open,
      bottom: mergeY,
    };
  }

  function layoutLoop(model, statement, cx, topY) {
    const node = addNode(model, "decision", `${statement.keyword}: ${statement.text}`, cx, topY);
    const bodyTop = node.y + node.height + STYLE.gapY;
    const bodyLayout = layoutItems(model, statement.body, cx, bodyTop);
    const bottom = Math.max(bodyLayout.bottom || bodyTop, bodyTop) + STYLE.gapY / 2;
    const falsePort = port(node, "right");
    const truePort = port(node, "bottom");
    const loopBackX = cx - Math.max(STYLE.loopReturnOffset, measureItems(statement.body).width / 2 + 28);

    if (bodyLayout.entry) {
      connectVertical(model, truePort, bodyLayout.entry, "repeat");
    } else {
      model.edges.push(createEdge([truePort, { x: truePort.x, y: bottom }, port(node, "top")], "repeat"));
    }

    if (bodyLayout.open && bodyLayout.exit) {
      model.edges.push(
        createEdge(
          [
            bodyLayout.exit,
            { x: loopBackX, y: bodyLayout.exit.y },
            { x: loopBackX, y: node.y + node.height / 2 },
            port(node, "left"),
          ]
        )
      );
    }

    model.edges.push(
      createEdge(
        [
          falsePort,
          { x: falsePort.x + 24, y: falsePort.y },
          { x: falsePort.x + 24, y: bottom },
          { x: cx, y: bottom },
        ],
        "done"
      )
    );

    return {
      entry: port(node, "top"),
      exit: { x: cx, y: bottom },
      open: true,
      bottom,
    };
  }

  function layoutGroup(model, statement, cx, topY) {
    const node = addNode(model, "group", statement.text, cx, topY);

    if (!statement.body.length) {
      return {
        entry: port(node, "top"),
        exit: port(node, "bottom"),
        open: true,
        bottom: node.y + node.height,
      };
    }

    const bodyLayout = layoutItems(model, statement.body, cx, node.y + node.height + STYLE.gapY);

    if (bodyLayout.entry) {
      connectVertical(model, port(node, "bottom"), bodyLayout.entry);
    }

    return {
      entry: port(node, "top"),
      exit: bodyLayout.exit,
      open: bodyLayout.open,
      bottom: bodyLayout.bottom,
    };
  }

  function layoutStatement(model, statement, cx, topY) {
    if (statement.type === "decision") {
      return layoutDecision(model, statement, cx, topY);
    }

    if (statement.type === "loop") {
      return layoutLoop(model, statement, cx, topY);
    }

    if (statement.type === "group") {
      return layoutGroup(model, statement, cx, topY);
    }

    const node = addNode(model, statement.type === "terminal" ? "terminal" : "process", statement.text, cx, topY);
    return {
      entry: port(node, "top"),
      exit: statement.type === "terminal" ? null : port(node, "bottom"),
      open: statement.type !== "terminal",
      bottom: node.y + node.height,
    };
  }

  function buildChart(items) {
    const model = createModel();
    const contentWidth = Math.max(measureItems(items).width, 320);
    const centerX = STYLE.margin + contentWidth / 2;
    const start = addNode(model, "start", "Start", centerX, STYLE.margin);
    const flow = layoutItems(model, items, centerX, start.y + start.height + STYLE.gapY);

    if (flow.entry) {
      connectVertical(model, port(start, "bottom"), flow.entry);
    }

    if (flow.open && flow.exit) {
      const end = addNode(model, "end", "End", centerX, flow.bottom + STYLE.gapY);
      connectVertical(model, flow.exit, port(end, "top"));
    }

    return model;
  }

  function normalizeModel(model) {
    const width = Math.max(480, model.maxX - model.minX + STYLE.margin * 2);
    const height = Math.max(280, model.maxY + STYLE.margin);
    const offsetX = STYLE.margin - model.minX;

    return {
      width,
      height,
      nodes: model.nodes.map((node) => ({
        ...node,
        x: node.x + offsetX,
      })),
      edges: model.edges.map((edge) => ({
        ...edge,
        points: edge.points.map((point) => ({ x: point.x + offsetX, y: point.y })),
      })),
    };
  }

  function renderText(node) {
    const cx = node.x + node.width / 2;
    const startY = node.y + node.height / 2 - ((node.lines.length - 1) * STYLE.textLineHeight) / 2 + 5;
    return node.lines
      .map(
        (line, index) =>
          `<text x="${cx}" y="${startY + index * STYLE.textLineHeight}" text-anchor="middle">${escapeHtml(line)}</text>`
      )
      .join("");
  }

  function renderNode(node) {
    const fill = getNodeFill(node.type);

    if (node.type === "decision") {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      const points = [
        `${cx},${node.y}`,
        `${node.x + node.width},${cy}`,
        `${cx},${node.y + node.height}`,
        `${node.x},${cy}`,
      ].join(" ");

      return `<g class="node decision"><polygon points="${points}" fill="${fill}" stroke="${CHART_COLORS.stroke}" stroke-width="2.2"/>${renderText(node)}</g>`;
    }

    return `<g class="node ${node.type}">
      <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${STYLE.cornerRadius}" fill="${fill}" stroke="${CHART_COLORS.stroke}" stroke-width="2.2"/>
      ${renderText(node)}
    </g>`;
  }

  function renderEdge(edge) {
    const path = edge.points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");

    const midpointIndex = Math.floor(edge.points.length / 2);
    const labelPoint = edge.points[midpointIndex];
    const label = edge.label
      ? `<text x="${labelPoint.x + 8}" y="${labelPoint.y - 8}" fill="${CHART_COLORS.edgeLabel}" font-size="12">${escapeHtml(edge.label)}</text>`
      : "";

    return `<g class="edge">
      <path d="${path}" fill="none" stroke="${CHART_COLORS.edge}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrowhead)"/>
      ${label}
    </g>`;
  }

  function renderSvg(model) {
    const normalized = normalizeModel(model);

    return `<svg width="${normalized.width}" height="${normalized.height}" viewBox="0 0 ${normalized.width} ${normalized.height}" role="img" aria-label="Flow chart">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="${CHART_COLORS.edge}"></polygon>
        </marker>
      </defs>
      <style>
        text {
          fill: ${CHART_COLORS.text};
          font: 600 13px/1.3 "IBM Plex Sans", "Segoe UI", sans-serif;
        }
      </style>
      ${normalized.edges.map(renderEdge).join("")}
      ${normalized.nodes.map(renderNode).join("")}
    </svg>`;
  }

  function getNodeFill(type) {
    if (type === "start") {
      return CHART_COLORS.start;
    }
    if (type === "end") {
      return CHART_COLORS.end;
    }
    if (type === "decision") {
      return CHART_COLORS.decision;
    }
    if (type === "group") {
      return CHART_COLORS.group;
    }
    if (type === "terminal") {
      return CHART_COLORS.terminal;
    }
    return CHART_COLORS.process;
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawDecision(ctx, node) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;

    ctx.beginPath();
    ctx.moveTo(cx, node.y);
    ctx.lineTo(node.x + node.width, cy);
    ctx.lineTo(cx, node.y + node.height);
    ctx.lineTo(node.x, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawEdge(ctx, edge) {
    ctx.beginPath();
    ctx.moveTo(edge.points[0].x, edge.points[0].y);
    for (let i = 1; i < edge.points.length; i += 1) {
      ctx.lineTo(edge.points[i].x, edge.points[i].y);
    }
    ctx.stroke();

    const end = edge.points[edge.points.length - 1];
    const prev = edge.points[edge.points.length - 2] || end;
    const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
    const arrowLength = 10;
    const arrowAngle = Math.PI / 7;

    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - arrowLength * Math.cos(angle - arrowAngle),
      end.y - arrowLength * Math.sin(angle - arrowAngle)
    );
    ctx.lineTo(
      end.x - arrowLength * Math.cos(angle + arrowAngle),
      end.y - arrowLength * Math.sin(angle + arrowAngle)
    );
    ctx.closePath();
    ctx.fill();

    if (edge.label) {
      const labelPoint = edge.points[Math.floor(edge.points.length / 2)];
      ctx.fillStyle = CHART_COLORS.edgeLabel;
      ctx.font = '600 12px "IBM Plex Sans", "Segoe UI", sans-serif';
      ctx.fillText(edge.label, labelPoint.x + 8, labelPoint.y - 8);
    }
  }

  function drawNodeText(ctx, node) {
    const centerX = node.x + node.width / 2;
    const startY = node.y + node.height / 2 - ((node.lines.length - 1) * STYLE.textLineHeight) / 2 + 5;

    ctx.fillStyle = CHART_COLORS.text;
    ctx.font = '600 13px "IBM Plex Sans", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 0; i < node.lines.length; i += 1) {
      ctx.fillText(node.lines[i], centerX, startY + i * STYLE.textLineHeight);
    }
  }

  function renderCanvas(canvas, model) {
    const normalized = normalizeModel(model);
    const ratio = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");

    canvas.width = Math.ceil(normalized.width * ratio);
    canvas.height = Math.ceil(normalized.height * ratio);
    canvas.style.width = `${normalized.width}px`;
    canvas.style.height = `${normalized.height}px`;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, normalized.width, normalized.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = CHART_COLORS.edge;
    ctx.fillStyle = CHART_COLORS.edge;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const edge of normalized.edges) {
      drawEdge(ctx, edge);
    }

    ctx.strokeStyle = CHART_COLORS.stroke;

    for (const node of normalized.nodes) {
      ctx.fillStyle = getNodeFill(node.type);

      if (node.type === "decision") {
        drawDecision(ctx, node);
      } else {
        drawRoundedRect(ctx, node.x, node.y, node.width, node.height, STYLE.cornerRadius);
        ctx.fill();
        ctx.stroke();
      }

      drawNodeText(ctx, node);
    }

    return normalized;
  }

  window.FlowChartLab = {
    SAMPLE_CODE,
    STYLE,
    debounce,
    escapeHtml,
    parseCode,
    buildChart,
    renderSvg,
    renderCanvas,
  };
})();
