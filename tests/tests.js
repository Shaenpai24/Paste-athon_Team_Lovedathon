/**
 * tests.js — browser-based test suite for ChainForge's initial commit.
 *
 * Covers:
 *   - LeetCode 210 canonical cases (healthy + cycle)
 *   - Larger LC-style DAGs
 *   - BFS layer correctness (longest-path depth from any root)
 *   - Cycle detection returning the correct remaining set
 *   - Graph invariants (indegree caching, duplicate edges)
 *   - Validity: every edge u->v has layer(u) < layer(v) when successful
 *
 * All assertions run on page load and render to #results.
 */
(function () {
  'use strict';

  const { Graph, kahn, findOrder } = window.ChainForge;

  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg || 'assertion failed');
  };
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* ------------- LeetCode 210 canonical cases ---------------------------- */

  test('LC210: numCourses=2, [[1,0]] -> [0,1]', () => {
    assert(deepEq(findOrder(2, [[1, 0]]), [0, 1]));
  });

  test('LC210: numCourses=4, [[1,0],[2,0],[3,1],[3,2]] respects all edges', () => {
    const order = findOrder(4, [[1, 0], [2, 0], [3, 1], [3, 2]]);
    assert(order.length === 4, 'length 4');
    const pos = new Map(order.map((v, i) => [v, i]));
    for (const [a, b] of [[1, 0], [2, 0], [3, 1], [3, 2]]) {
      assert(pos.get(b) < pos.get(a), `${b} must precede ${a}`);
    }
  });

  test('LC210: cycle -> []', () => {
    assert(deepEq(findOrder(2, [[1, 0], [0, 1]]), []));
  });

  test('LC210: numCourses=1, [] -> [0]', () => {
    assert(deepEq(findOrder(1, []), [0]));
  });

  test('LC210: numCourses=0, [] -> []', () => {
    assert(deepEq(findOrder(0, []), []));
  });

  /* ------------- Kahn core algorithm ------------------------------------ */

  test('kahn: empty graph is success with empty order', () => {
    const g = new Graph();
    const r = kahn(g);
    assert(r.success === true);
    assert(r.order.length === 0);
    assert(r.layers.length === 0);
  });

  test('kahn: isolated nodes all land in layer 0', () => {
    const g = new Graph();
    ['a', 'b', 'c'].forEach((id) => g.addNode(id));
    const r = kahn(g);
    assert(r.success && r.order.length === 3);
    assert(r.layers.length === 1);
    assert(r.layers[0].length === 3);
  });

  test('kahn: linear chain produces V layers of 1 node each', () => {
    const g = new Graph();
    g.addEdge('a', 'b');
    g.addEdge('b', 'c');
    g.addEdge('c', 'd');
    const r = kahn(g);
    assert(r.success);
    assert(deepEq(r.order, ['a', 'b', 'c', 'd']));
    assert(r.layers.length === 4);
    for (let i = 0; i < 4; i++) assert(r.layers[i].length === 1);
  });

  test('kahn: diamond — b and c share layer 1, d is layer 2', () => {
    const g = new Graph();
    g.addEdge('a', 'b');
    g.addEdge('a', 'c');
    g.addEdge('b', 'd');
    g.addEdge('c', 'd');
    const r = kahn(g);
    assert(r.success);
    assert(r.layerOf.get('a') === 0);
    assert(r.layerOf.get('b') === 1);
    assert(r.layerOf.get('c') === 1);
    assert(r.layerOf.get('d') === 2);
  });

  test('kahn: layer index equals length of longest prerequisite path', () => {
    // Z sits on two paths: a->b->z (len 2) and a->z (len 1). Longest => layer 2.
    const g = new Graph();
    g.addEdge('a', 'b');
    g.addEdge('b', 'z');
    g.addEdge('a', 'z');
    const r = kahn(g);
    assert(r.success);
    assert(r.layerOf.get('z') === 2, `z layer expected 2, got ${r.layerOf.get('z')}`);
  });

  test('kahn: every edge respects layer ordering layer(u) < layer(v)', () => {
    const g = new Graph();
    const edges = [
      ['m1', 'alg'], ['alg', 'fn'], ['fn', 'cal'],
      ['m1', 'log'], ['log', 'prf'], ['prf', 'disc'],
      ['alg', 'disc'], ['disc', 'ds'], ['cal', 'prob'],
      ['disc', 'prob'], ['ds', 'gra'], ['prob', 'gra'],
      ['gra', 'ts'], ['ds', 'ts'],
    ];
    edges.forEach(([u, v]) => g.addEdge(u, v));
    const r = kahn(g);
    assert(r.success);
    for (const [u, v] of edges) {
      assert(
        r.layerOf.get(u) < r.layerOf.get(v),
        `layer(${u})=${r.layerOf.get(u)} must be < layer(${v})=${r.layerOf.get(v)}`
      );
    }
  });

  test('kahn: topological order is a valid linearisation', () => {
    const g = new Graph();
    const edges = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'e'], ['b', 'e']];
    edges.forEach(([u, v]) => g.addEdge(u, v));
    const r = kahn(g);
    const pos = new Map(r.order.map((x, i) => [x, i]));
    for (const [u, v] of edges) {
      assert(pos.get(u) < pos.get(v), `${u} must come before ${v}`);
    }
  });

  test('kahn: cycle detection returns all cycle-participating nodes', () => {
    const g = new Graph();
    g.addEdge('a', 'b');
    g.addEdge('b', 'c');
    g.addEdge('c', 'a');     // cycle a -> b -> c -> a
    g.addEdge('x', 'y');     // healthy branch
    const r = kahn(g);
    assert(!r.success, 'should fail');
    const set = new Set(r.cycleNodes);
    ['a', 'b', 'c'].forEach((id) => assert(set.has(id), `${id} on cycle`));
    // x, y must not be reported as cycle members
    assert(!set.has('x') && !set.has('y'));
  });

  test('kahn: self-loop is a cycle', () => {
    const g = new Graph();
    g.addEdge('a', 'a');
    const r = kahn(g);
    assert(!r.success);
    assert(r.cycleNodes.length === 1 && r.cycleNodes[0] === 'a');
  });

  /* ------------- Graph invariants --------------------------------------- */

  test('Graph: duplicate edge does not double-count indegree', () => {
    const g = new Graph();
    g.addEdge('a', 'b');
    g.addEdge('a', 'b');
    g.addEdge('a', 'b');
    assert(g.indegree('b') === 1);
    assert(g.edgeCount() === 1);
  });

  test('Graph: addNode is idempotent', () => {
    const g = new Graph();
    g.addNode('a', 'First');
    g.addNode('a', 'Second'); // ignored
    assert(g.getNode('a').label === 'First');
  });

  test('Graph: addEdge auto-creates missing endpoints', () => {
    const g = new Graph();
    g.addEdge('p', 'q');
    assert(g.hasNode('p') && g.hasNode('q'));
  });

  /* ------------- Performance sanity (small stress) ---------------------- */

  test('kahn: 2000-node chain completes successfully', () => {
    const g = new Graph();
    for (let i = 0; i < 1999; i++) g.addEdge('n' + i, 'n' + (i + 1));
    const r = kahn(g);
    assert(r.success);
    assert(r.order.length === 2000);
    assert(r.layers.length === 2000);
  });

  /* ------------- runner ------------------------------------------------- */

  function run() {
    const root = document.getElementById('results');
    const summary = document.getElementById('summary');
    let passed = 0;
    for (const { name, fn } of cases) {
      const li = document.createElement('li');
      try {
        fn();
        li.className = 'pass';
        li.textContent = '✓ ' + name;
        passed++;
      } catch (err) {
        li.className = 'fail';
        li.textContent = '✗ ' + name + '  —  ' + err.message;
      }
      root.appendChild(li);
    }
    summary.textContent = `${passed} / ${cases.length} passed`;
    summary.className = passed === cases.length ? 'ok' : 'err';
  }

  document.addEventListener('DOMContentLoaded', run);
})();
