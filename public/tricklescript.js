(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TrickleScript = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const BUILTINS = new Set(["say", "concat", "eq"]);

  function tokenizeLine(line) {
    const tokens = [];
    let i = 0;

    while (i < line.length) {
      const char = line[i];

      if (/\s/.test(char)) {
        i += 1;
        continue;
      }

      if (char === '"') {
        let value = "";
        i += 1;

        while (i < line.length) {
          const current = line[i];
          if (current === "\\") {
            const next = line[i + 1];
            if (next === "n") {
              value += "\n";
            } else if (next === "t") {
              value += "\t";
            } else if (next === '"' || next === "\\") {
              value += next;
            } else {
              value += next || "";
            }
            i += 2;
            continue;
          }

          if (current === '"') {
            i += 1;
            break;
          }

          value += current;
          i += 1;
        }

        tokens.push({ type: "string", value });
        continue;
      }

      let raw = "";
      while (i < line.length && !/\s/.test(line[i])) {
        raw += line[i];
        i += 1;
      }

      tokens.push({ type: "word", value: raw });
    }

    return tokens;
  }

  function parseInstruction(lineNumber, tokens) {
    if (tokens.length === 1 && tokens[0].type === "word" && tokens[0].value.endsWith(":")) {
      const name = tokens[0].value.slice(0, -1);
      return { type: "label", name, line: lineNumber, raw: tokens[0].value };
    }

    if (tokens.length === 1 && tokens[0].type === "word" && tokens[0].value.startsWith("*")) {
      return { type: "goto", target: tokens[0].value.slice(1), line: lineNumber, raw: tokens[0].value };
    }

    if (tokens.length === 1 && tokens[0].type === "word" && tokens[0].value.startsWith("?")) {
      return { type: "otherwiseGoto", target: tokens[0].value.slice(1), line: lineNumber, raw: tokens[0].value };
    }

    if (tokens.length === 1 && tokens[0].type === "word" && tokens[0].value === "return") {
      return { type: "return", line: lineNumber, raw: "return" };
    }

    return {
      type: "operation",
      tokens,
      line: lineNumber,
      raw: tokens.map((token) => {
        if (token.type === "string") {
          return JSON.stringify(token.value);
        }
        return token.value;
      }).join(" ")
    };
  }

  function parse(source) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const routines = [];
    let currentRoutine = null;
    let sawBlankLine = true;

    function startRoutine(name, lineNumber) {
      const routine = {
        name,
        entryLabel: name,
        line: lineNumber,
        instructions: [],
        labels: Object.assign(Object.create(null), { [name]: 0 }),
        params: []
      };
      routines.push(routine);
      currentRoutine = routine;
      return routine;
    }

    function ensureMain(lineNumber) {
      if (!currentRoutine) {
        return startRoutine("main", lineNumber);
      }
      return currentRoutine;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const trimmed = rawLine.trim();

      if (!trimmed) {
        sawBlankLine = true;
        continue;
      }

      const tokens = tokenizeLine(rawLine);
      if (tokens.length === 0) {
        sawBlankLine = true;
        continue;
      }

      const onlyLabel = tokens.length === 1 && tokens[0].type === "word" && tokens[0].value.endsWith(":");

      if (onlyLabel && (sawBlankLine || !currentRoutine)) {
        startRoutine(tokens[0].value.slice(0, -1), index + 1);
        sawBlankLine = false;
        continue;
      }

      const routine = ensureMain(index + 1);
      const instruction = parseInstruction(index + 1, tokens);

      if (instruction.type === "label") {
        if (Object.prototype.hasOwnProperty.call(routine.labels, instruction.name)) {
          throw new Error(`Duplicate label "${instruction.name}" on line ${instruction.line}`);
        }
        routine.labels[instruction.name] = routine.instructions.length;
      }

      routine.instructions.push(instruction);
      sawBlankLine = false;
    }

    for (const routine of routines) {
      inferRoutineParams(routine, routines);
      validateRoutine(routine);
    }

    const routineMap = Object.create(null);
    for (const routine of routines) {
      routineMap[routine.name] = routine;
    }

    return { routines, routineMap };
  }

  function inferRoutineParams(routine, allRoutines) {
    const routineNames = new Set(allRoutines.map((entry) => entry.name));
    const labelNames = new Set(Object.keys(routine.labels));
    const explicitStores = [];
    const params = [];

    function remember(name) {
      if (!params.includes(name)) params.push(name);
    }

    for (const instruction of routine.instructions) {
      if (instruction.type !== "operation") continue;

      for (const token of instruction.tokens) {
        if (token.type !== "word") continue;
        const word = token.value;

        if (word.startsWith(">") && word.length > 1) {
          const name = word.slice(1);
          if (!explicitStores.includes(name)) explicitStores.push(name);
          continue;
        }

        if (BUILTINS.has(word) || routineNames.has(word) || labelNames.has(word)) continue;
        if (word === "return" || word === "true" || word === "false") continue;
        if (/^-?\d+(?:\.\d+)?$/.test(word)) continue;
        remember(word);
      }
    }

    routine.storeParams = explicitStores.slice();
    routine.params = explicitStores.length > 0 ? [] : params;
  }

  function validateRoutine(routine) {
    for (const instruction of routine.instructions) {
      if ((instruction.type === "goto" || instruction.type === "otherwiseGoto") &&
          !Object.prototype.hasOwnProperty.call(routine.labels, instruction.target)) {
        throw new Error(`Unknown label "${instruction.target}" in ${routine.name} on line ${instruction.line}`);
      }
    }
  }

  function coerceLiteral(token, frame, program, options) {
    if (token.type === "string") return token.value;
    const word = token.value;

    if (word === "true") return true;
    if (word === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(word)) return Number(word);
    if (Object.prototype.hasOwnProperty.call(frame.locals, word)) return frame.locals[word];
    if (options && options.env && Object.prototype.hasOwnProperty.call(options.env, word)) {
      return options.env[word];
    }

    if (BUILTINS.has(word)) return { builtin: word };
    if (program.routineMap[word]) return { call: word };
    return word;
  }

  function runBuiltin(name, stack, output) {
    if (name === "say") {
      const value = stack.pop();
      output.push(String(value));
      return;
    }

    if (name === "concat") {
      const right = stack.pop();
      const left = stack.pop();
      stack.push(String(left) + String(right));
      return;
    }

    if (name === "eq") {
      const right = stack.pop();
      const left = stack.pop();
      stack.push(left === right);
    }
  }

  function executeRoutine(program, routineName, stack, output, options, callStack) {
    const routine = program.routineMap[routineName];
    if (!routine) throw new Error(`Unknown routine "${routineName}"`);
    if (callStack.includes(routineName)) {
      throw new Error(`Recursive routine "${routineName}" is not supported`);
    }

    const args = stack.splice(Math.max(0, stack.length - routine.params.length), routine.params.length);
    const locals = Object.create(null);
    for (let i = 0; i < routine.params.length; i += 1) {
      if (i < args.length) {
        locals[routine.params[i]] = args[i];
      }
    }

    const frame = { locals };
    const instructions = routine.instructions;
    let pc = 0;

    while (pc < instructions.length) {
      const instruction = instructions[pc];

      if (instruction.type === "label") {
        pc += 1;
        continue;
      }

      if (instruction.type === "goto") {
        pc = routine.labels[instruction.target];
        continue;
      }

      if (instruction.type === "otherwiseGoto") {
        const condition = stack.pop();
        if (!condition) {
          pc = routine.labels[instruction.target];
        } else {
          pc += 1;
        }
        continue;
      }

      if (instruction.type === "return") {
        return;
      }

      for (const token of instruction.tokens) {
        if (token.type === "word" && token.value.startsWith(">") && token.value.length > 1) {
          frame.locals[token.value.slice(1)] = stack.pop();
          continue;
        }

        const value = coerceLiteral(token, frame, program, options);

        if (value && value.builtin) {
          runBuiltin(value.builtin, stack, output);
          continue;
        }

        if (value && value.call) {
          executeRoutine(program, value.call, stack, output, options, callStack.concat(routineName));
          continue;
        }

        stack.push(value);
      }

      pc += 1;
    }
  }

  function run(source, options) {
    const program = typeof source === "string" ? parse(source) : source;
    const runtimeOptions = options || {};
    const stack = (runtimeOptions.stack || []).slice();
    const output = [];
    let entry = runtimeOptions.entry || "main";

    if (!program.routineMap[entry]) {
      entry = program.routines[0] ? program.routines[0].name : "main";
    }

    executeRoutine(program, entry, stack, output, runtimeOptions, []);

    return {
      stack,
      output,
      program,
      entry
    };
  }

  function buildFlowGraph(source, options) {
    const program = typeof source === "string" ? parse(source) : source;
    const entry = options && options.entry ? options.entry : (program.routineMap.main ? "main" : program.routines[0].name);
    const routine = program.routineMap[entry];
    if (!routine) throw new Error(`Unknown routine "${entry}"`);

    const visibleIndices = [];
    const visibleByIndex = Object.create(null);
    const nodes = [];
    const edges = [];

    for (let i = 0; i < routine.instructions.length; i += 1) {
      const instruction = routine.instructions[i];
      if (instruction.type === "operation" || instruction.type === "otherwiseGoto" || instruction.type === "return") {
        const node = {
          id: "n" + nodes.length,
          instructionIndex: i,
          type: instruction.type === "otherwiseGoto" ? "decision" : "process",
          label: instruction.type === "otherwiseGoto" ? "Condition" : instruction.raw
        };
        if (instruction.type === "otherwiseGoto") {
          node.label = "stack top truthy?";
        }
        nodes.push(node);
        visibleIndices.push(i);
        visibleByIndex[i] = node;
      }
    }

    const startNode = { id: "start", type: "start", label: entry };
    const endNode = { id: "end", type: "end", label: "End" };
    nodes.unshift(startNode);
    nodes.push(endNode);

    function follow(index, seen) {
      let current = index;
      const visited = seen || new Set();

      while (current < routine.instructions.length) {
        if (visibleByIndex[current]) return visibleByIndex[current].id;
        if (visited.has(current)) return null;
        visited.add(current);

        const instruction = routine.instructions[current];
        if (!instruction) return null;

        if (instruction.type === "label") {
          current += 1;
          continue;
        }

        if (instruction.type === "goto") {
          current = routine.labels[instruction.target];
          continue;
        }

        return null;
      }

      return null;
    }

    function nextExecutable(index) {
      let current = index;
      while (current < routine.instructions.length) {
        const instruction = routine.instructions[current];
        if (!instruction) return null;
        if (instruction.type === "label") {
          current += 1;
          continue;
        }
        return instruction;
      }
      return null;
    }

    const firstVisible = follow(0);
    if (firstVisible) edges.push({ from: startNode.id, to: firstVisible, label: "" });
    else edges.push({ from: startNode.id, to: endNode.id, label: "" });

    for (const node of nodes) {
      if (node.instructionIndex === undefined && node.id !== "start") continue;
      if (node.id === "start" || node.id === "end") continue;

      const instruction = routine.instructions[node.instructionIndex];
      if (instruction.type === "otherwiseGoto") {
        const yesTarget = follow(node.instructionIndex + 1);
        const noTarget = follow(routine.labels[instruction.target]);
        edges.push({ from: node.id, to: yesTarget || endNode.id, label: "Yes" });
        edges.push({ from: node.id, to: noTarget || endNode.id, label: "No" });
        continue;
      }

      if (instruction.type === "return") {
        edges.push({ from: node.id, to: endNode.id, label: "" });
        continue;
      }

      const nextTarget = follow(node.instructionIndex + 1);
      const nextInstruction = nextExecutable(node.instructionIndex + 1);
      edges.push({
        from: node.id,
        to: nextTarget || endNode.id,
        label: "",
        viaGoto: nextInstruction && nextInstruction.type === "goto"
      });
    }

    const conditionalRanges = [];
    for (let i = 0; i < routine.instructions.length; i += 1) {
      const instruction = routine.instructions[i];
      if (instruction.type !== "otherwiseGoto") continue;
      const targetIndex = routine.labels[instruction.target];
      if (targetIndex > i) {
        conditionalRanges.push({ start: i, end: targetIndex });
      }
    }

    const positions = Object.create(null);
    let row = 0;
    let maxCol = 0;

    positions[startNode.id] = { x: 70, y: 40, col: 0, row: row, w: 170, h: 52 };
    row += 1;

    for (const index of visibleIndices) {
      let col = 0;
      for (const range of conditionalRanges) {
        if (index > range.start && index < range.end) col += 1;
      }
      positions[visibleByIndex[index].id] = {
        x: 70 + col * 230,
        y: 40 + row * 120,
        col,
        row,
        w: 170,
        h: 52
      };
      maxCol = Math.max(maxCol, col);
      row += 1;
    }

    positions[endNode.id] = { x: 70, y: 40 + row * 120, col: 0, row, w: 170, h: 52 };

    return {
      program,
      entry,
      routine,
      nodes,
      edges,
      positions,
      totalWidth: 140 + (maxCol + 1) * 230,
      totalHeight: 120 + (row + 1) * 120
    };
  }

  return {
    BUILTINS: Array.from(BUILTINS),
    tokenizeLine,
    parse,
    run,
    buildFlowGraph
  };
});
