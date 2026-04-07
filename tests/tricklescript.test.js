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
