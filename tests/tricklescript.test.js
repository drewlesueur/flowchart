const test = require("node:test");
const assert = require("node:assert/strict");

const TrickleScript = require("../public/tricklescript.js");

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

test("unknown goto labels are rejected", () => {
  const source = `
main:
?missingLabel
return
`;

  assert.throws(() => TrickleScript.parse(source), /Unknown label "missingLabel"/);
});
