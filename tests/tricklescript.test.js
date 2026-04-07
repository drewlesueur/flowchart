const test = require("node:test");
const assert = require("node:assert/strict");

const TrickleScript = require("../public/tricklescript.js");
const TrickleScriptRenderer = require("../public/tricklescript-renderer.js");
const TrickleScriptRendererV2 = require("../public/tricklescript-renderer-v2.js");

test("runs concat and say", () => {
  const source = `
greet:
"Hello " firstName concat lastName concat say
return
`;

  const result = TrickleScript.run(source, {
    entry: "greet",
    stack: ["Drew ", "LeSueur"]
  });

  assert.deepEqual(result.output, ["Hello Drew LeSueur"]);
  assert.deepEqual(result.stack, []);
});

test("explicit >name binding pops from the stack into locals", () => {
  const source = `
greet:
>lastName
>firstName
"Hello Mr. " firstName concat lastName concat say
return
`;

  const result = TrickleScript.run(source, {
    entry: "greet",
    stack: ["Drew ", "LeSueur"]
  });

  assert.deepEqual(result.output, ["Hello Mr. Drew LeSueur"]);
  assert.deepEqual(result.stack, []);
});

test("conditional goto skips block when condition is false", () => {
  const source = `
main:
x 3 eq
?endIfBlock1
"three" say
endIfBlock1:
"done" say
return
`;

  const result = TrickleScript.run(source, {
    env: { x: 2 }
  });

  assert.deepEqual(result.output, ["done"]);
});

test("if else shape executes the else block", () => {
  const source = `
main:
x 3 eq
?endIfBlock1
"three" say
*endIf1
endIfBlock1:
"other" say
endIf1:
"done" say
return
`;

  const result = TrickleScript.run(source, {
    env: { x: 2 }
  });

  assert.deepEqual(result.output, ["other", "done"]);
});

test("else if chain executes the matching branch", () => {
  const source = `
main:
x 3 eq
?endIfBlock1
"three" say
*endIf1
endIfBlock1:
x 2 eq
?endIfBlock2
"two" say
*endIf1
endIfBlock2:
"other" say
endIf1:
"done" say
return
`;

  const result = TrickleScript.run(source, {
    env: { x: 2 }
  });

  assert.deepEqual(result.output, ["two", "done"]);
});

test("buildFlowGraph creates decision yes/no edges", () => {
  const source = `
main:
x 3 eq
?endIfBlock1
doThreeThing
endIfBlock1:
carryOn
return
`;

  const graph = TrickleScript.buildFlowGraph(source, { entry: "main" });
  const decision = graph.nodes.find((node) => node.type === "decision");
  const yesEdge = graph.edges.find((edge) => edge.from === decision.id && edge.label === "Yes");
  const noEdge = graph.edges.find((edge) => edge.from === decision.id && edge.label === "No");

  assert.ok(decision);
  assert.ok(yesEdge);
  assert.ok(noEdge);
  assert.notEqual(yesEdge.to, noEdge.to);
});

test("buildFlowGraph marks edges that flow through goto", () => {
  const source = `
main:
x 3 eq
?endIfBlock1
doThreeThing
*endIf1
endIfBlock1:
doOtherThing
endIf1:
carryOn
return
`;

  const graph = TrickleScript.buildFlowGraph(source, { entry: "main" });
  const doThree = graph.nodes.find((node) => node.label === "doThreeThing");
  const jumpEdge = graph.edges.find((edge) => edge.from === doThree.id);

  assert.equal(jumpEdge.viaGoto, true);
});

test("buildFlowGraph omits return nodes", () => {
  const source = `
main:
doThing
return
`;

  const graph = TrickleScript.buildFlowGraph(source, { entry: "main" });
  const returnNode = graph.nodes.find((node) => node.label === "return");
  const doThing = graph.nodes.find((node) => node.label === "doThing");
  const edgeToEnd = graph.edges.find((edge) => edge.from === doThing.id && edge.to === "end");

  assert.equal(returnNode, undefined);
  assert.ok(edgeToEnd);
});

test("alignYesTargets recomputes chart bounds after compacting rows", () => {
  const source = `
main:
hasRequest true eq
?noRequest
needsManager true eq
?skipManager
askManager
managerApproved true eq
?managerRejected
skipManager:
needsSecurity true eq
?skipSecurity
askSecurity
securityApproved true eq
?securityRejected
skipSecurity:
shipIt
return
managerRejected:
rework
return
securityRejected:
auditTrail
return
noRequest:
waitForRequest
return
`;

  const graph = TrickleScript.buildFlowGraph(source, { entry: "main" });
  const aligned = TrickleScriptRenderer.alignYesTargets(graph);

  assert.ok(aligned.totalHeight < graph.totalHeight);
});

test("alignYesTargets staggers leftward yes joins below the source decision", () => {
  const source = `
main:
hasRequest true eq
?noRequest
needsManager true eq
?skipManager
askManager
managerApproved true eq
?managerRejected
skipManager:
needsSecurity true eq
?skipSecurity
askSecurity
securityApproved true eq
?securityRejected
skipSecurity:
shipIt
return
managerRejected:
rework
return
securityRejected:
auditTrail
return
noRequest:
waitForRequest
return
`;

  const aligned = TrickleScriptRenderer.alignYesTargets(TrickleScript.buildFlowGraph(source, { entry: "main" }));
  const managerApproved = aligned.edges.find((edge) => edge.label === "Yes" && edge.from === "n6");
  const securityApproved = aligned.edges.find((edge) => edge.label === "Yes" && edge.from === "n11");

  assert.ok(aligned.positions[managerApproved.to].row > aligned.positions[managerApproved.from].row);
  assert.ok(aligned.positions[securityApproved.to].row > aligned.positions[securityApproved.from].row);
});

test("render routes leftward yes joins out to the right first", () => {
  const source = `
main:
first true eq
?skipShared
second true eq
?reject
shared:
finish
return
reject:
fail
return
skipShared:
wait
return
`;

  global.document = {
    createElementNS(ns, tag) {
      return {
        tag,
        attrs: {},
        children: [],
        setAttribute(key, value) { this.attrs[key] = value; },
        appendChild(child) { this.children.push(child); },
        textContent: ""
      };
    },
    createElement(tag) {
      return {
        tag,
        attrs: {},
        children: [],
        value: "",
        textContent: "",
        setAttribute(key, value) { this.attrs[key] = value; },
        appendChild(child) { this.children.push(child); }
      };
    }
  };

  const graph = TrickleScriptRenderer.alignYesTargets(TrickleScript.buildFlowGraph(source, { entry: "main" }));
  const mount = { innerHTML: "", children: [], appendChild(child) { this.children.push(child); } };
  TrickleScriptRenderer.render(graph, mount);

  const svg = mount.children[0];
  const yesPaths = svg.children
    .filter((child) => child.tag === "path")
    .map((child) => child.attrs.d)
    .filter((d) => typeof d === "string" && d.includes(" L "));

  assert.ok(yesPaths.some((d) => /L \d+ \d+ L \d+ \d+ L \d+ \d+$/.test(d)));
});

test("phase 2 tree keeps yes and no branches nested under decisions", () => {
  const source = `
main:
first true eq
?skipMain
second true eq
?skipSecond
work
return
skipSecond:
fallback
return
skipMain:
wait
return
`;

  const tree = TrickleScriptRendererV2.buildFlowTree(TrickleScript.buildFlowGraph(source, { entry: "main" }));
  const firstDecision = tree.root.find((item) => item.kind === "decision");

  assert.ok(firstDecision);
  assert.equal(firstDecision.yes[0].kind, "node");
  assert.equal(firstDecision.yes[1].kind, "decision");
  assert.equal(firstDecision.no[0].kind, "node");
});

test("phase 2 scene reveals more nested nodes at higher zoom", () => {
  const source = `
main:
first true eq
?skipMain
second true eq
?skipSecond
work
return
skipSecond:
fallback
return
skipMain:
wait
return
`;

  const tree = TrickleScriptRendererV2.buildFlowTree(TrickleScript.buildFlowGraph(source, { entry: "main" }));
  const lowZoom = TrickleScriptRendererV2.buildScene(tree, { zoom: 0.7 });
  const highZoom = TrickleScriptRendererV2.buildScene(tree, { zoom: 2.4 });

  assert.ok(lowZoom.labels.length < highZoom.labels.length);
  assert.equal(TrickleScriptRendererV2.getDetailDepth(0.7), 0);
  assert.equal(TrickleScriptRendererV2.getDetailDepth(2.4), 4);
});

test("unknown goto labels are rejected", () => {
  const source = `
main:
?missingLabel
return
`;

  assert.throws(() => TrickleScript.parse(source), /Unknown label "missingLabel"/);
});

test("routine entry label can be used as a loop target", () => {
  const source = `
main:
count 3 eq
?done
tick
count 2 eq
?countWasTwo
midLoopWork
*afterTwoCheck
countWasTwo:
specialCase
afterTwoCheck:
*main
done:
finish
return
`;

  const program = TrickleScript.parse(source);

  assert.equal(program.routineMap.main.labels.main, 0);
});
