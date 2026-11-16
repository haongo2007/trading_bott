import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGraph, evalCondition, flowGraphSchema, nextNodeId, renderTemplate, stepsToGraph, validateFlow } from "../src/lib/flow";

test("renderTemplate thay biến, giữ nguyên biến không tồn tại", () => {
  assert.equal(renderTemplate("Xin chào {{ name }} - {{amount}}", { name: "demo", amount: 10000 }), "Xin chào demo - 10000");
  assert.equal(renderTemplate("{{missing}}", {}), "{{missing}}");
});

test("evalCondition so sánh số và chuỗi", () => {
  const vars = { balance: 10_000_000, status: "Thắng", empty: "" };
  assert.equal(evalCondition("balance", ">", "5000000", vars), true);
  assert.equal(evalCondition("balance", "<", "5000000", vars), false);
  assert.equal(evalCondition("{{balance}}", "==", "10000000", vars), true);
  assert.equal(evalCondition("status", "contains", "thắng", vars), true);
  assert.equal(evalCondition("status", "==", "Thua", vars), false);
  assert.equal(evalCondition("balance", "exists", undefined, vars), true);
  assert.equal(evalCondition("nope", "exists", undefined, vars), false);
  assert.equal(evalCondition("empty", "exists", undefined, vars), false);
  assert.equal(evalCondition("status", ">", "1", vars), false, "so sánh lớn/nhỏ với chữ luôn false");
});

test("stepsToGraph tạo chuỗi start → goto → bước → end", () => {
  const g = stepsToGraph(
    [
      { action: "click", selector: "#username" },
      { action: "fill", selector: "#username", value: "{{username}}" },
      { action: "press", key: "Enter" },
    ],
    "http://localhost:4100/login",
  );
  assert.deepEqual(g.nodes.map((n) => n.type), ["start", "goto", "click", "fill", "press", "end"]);
  assert.equal(g.edges.length, 5);
  let id: string | null = "start";
  const order: string[] = [];
  while (id) {
    order.push(g.nodes.find((n) => n.id === id)!.type);
    id = nextNodeId(g, id);
  }
  assert.deepEqual(order, ["start", "goto", "click", "fill", "press", "end"]);
  assert.deepEqual(validateFlow(g), []);
  assert.equal(flowGraphSchema.safeParse(g).success, true);
});

test("validateFlow phát hiện lỗi cấu hình", () => {
  const g = defaultGraph();
  g.nodes.push({ id: "c1", type: "click", position: { x: 0, y: 0 }, data: {} });
  g.nodes.push({ id: "k1", type: "condition", position: { x: 0, y: 0 }, data: { left: "balance", op: ">" } });
  g.edges.push({ id: "x", source: "k1", target: "end", sourceHandle: "true" });
  const msgs = validateFlow(g).map((e) => e.message);
  assert.ok(msgs.some((m) => m.includes("thiếu selector")));
  assert.ok(msgs.some((m) => m.includes("nhánh “Sai”")));
  assert.ok(!msgs.some((m) => m.includes("nhánh “Đúng”")));
});

test("validateFlow yêu cầu đúng 1 khối Bắt đầu", () => {
  const g = defaultGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "start");
  assert.ok(validateFlow(g).some((e) => e.message.includes("đúng 1 khối Bắt đầu")));
});

test("schema từ chối tên biến không hợp lệ", () => {
  const g = defaultGraph();
  g.nodes.push({ id: "r", type: "readText", position: { x: 0, y: 0 }, data: { selector: "#b", saveAs: "1abc" } });
  assert.equal(flowGraphSchema.safeParse(g).success, false);
});
