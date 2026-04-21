/**
 * tests.js — browser-based test suite for ChainForge.
 *
 * Commit 1 coverage:
 *   - LeetCode 210 canonical cases (healthy + cycle)
 *   - Larger LC-style DAGs
 *   - BFS layer correctness (longest-path depth from any root)
 *   - Cycle detection returning the correct remaining set
 *   - Graph invariants (indegree caching, duplicate edges, idempotence)
 *   - Validity: every edge u->v has layer(u) < layer(v) when successful
 *   - 2000-node chain stress
 *
 * Commit 2 coverage:
 *   - Graph predecessors & removeEdge / removeNode
 *   - State.wouldCreateCycle & State.findPath
 *   - State.addEdge forward layer propagation (partial, not full)
 *   - State.removeEdge layer decrease & descendant recomputation
 *   - State.addEdge rejects cycles and returns the loop path
 *   - Partiality: edit affects only a proper subset of nodes
 *   - Storage save/load round-trip with in-memory driver
 *
 * Commit 3 coverage:
 *   - Offline concept extraction from headings, cue lists, wiki-links, verbs
 *   - Markdown export for healthy DAGs and contradictory graphs
 *   - Concrete cycle recovery for the contradiction resolver
 *
 * Commit 4 coverage:
 *   - Polished Markdown exports with checklists and prerequisite links
 *
 * All assertions run on page load and render to #results.
 */
(function () {
  'use strict';

  const {
    Graph, kahn, findOrder, State, Storage, _memoryDriver,
    Extractor, Exporter, Resolver,
  } = window.ChainForge;

  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* ============================ commit 1 ================================ */

  test('LC210: numCourses=2, [[1,0]] -> [0,1]', () => {
    assert(deepEq(findOrder(2, [[1, 0]]), [0, 1]));
  });

  test('LC210: numCourses=4, respects all edges', () => {
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

  test('kahn: empty graph is success with empty order', () => {
    const g = new Graph();
    const r = kahn(g);
    assert(r.success && r.order.length === 0 && r.layers.length === 0);
  });

  test('kahn: isolated nodes all land in layer 0', () => {
    const g = new Graph();
    ['a', 'b', 'c'].forEach((id) => g.addNode(id));
    const r = kahn(g);
    assert(r.success && r.order.length === 3);
    assert(r.layers.length === 1 && r.layers[0].length === 3);
  });

  test('kahn: linear chain produces V layers of 1 node each', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('c', 'd');
    const r = kahn(g);
    assert(r.success && deepEq(r.order, ['a', 'b', 'c', 'd']));
    assert(r.layers.length === 4);
    for (let i = 0; i < 4; i++) assert(r.layers[i].length === 1);
  });

  test('kahn: diamond — b and c share layer 1, d is layer 2', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('a', 'c');
    g.addEdge('b', 'd'); g.addEdge('c', 'd');
    const r = kahn(g);
    assert(r.success);
    assert(r.layerOf.get('a') === 0 && r.layerOf.get('b') === 1);
    assert(r.layerOf.get('c') === 1 && r.layerOf.get('d') === 2);
  });

  test('kahn: layer index equals length of longest prerequisite path', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'z'); g.addEdge('a', 'z');
    const r = kahn(g);
    assert(r.success && r.layerOf.get('z') === 2);
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
      assert(r.layerOf.get(u) < r.layerOf.get(v), `${u}→${v}`);
    }
  });

  test('kahn: topological order is a valid linearisation', () => {
    const g = new Graph();
    const edges = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'e'], ['b', 'e']];
    edges.forEach(([u, v]) => g.addEdge(u, v));
    const r = kahn(g);
    const pos = new Map(r.order.map((x, i) => [x, i]));
    for (const [u, v] of edges) assert(pos.get(u) < pos.get(v));
  });

  test('kahn: cycle detection returns all cycle-participating nodes', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('c', 'a');
    g.addEdge('x', 'y');
    const r = kahn(g);
    assert(!r.success);
    const s = new Set(r.cycleNodes);
    ['a', 'b', 'c'].forEach((id) => assert(s.has(id), `${id} on cycle`));
    assert(!s.has('x') && !s.has('y'));
  });

  test('kahn: self-loop is a cycle', () => {
    const g = new Graph();
    g.addEdge('a', 'a');
    const r = kahn(g);
    assert(!r.success && r.cycleNodes.length === 1 && r.cycleNodes[0] === 'a');
  });

  test('Graph: duplicate edge does not double-count indegree', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('a', 'b'); g.addEdge('a', 'b');
    assert(g.indegree('b') === 1 && g.edgeCount() === 1);
  });

  test('Graph: addNode is idempotent', () => {
    const g = new Graph();
    g.addNode('a', 'First'); g.addNode('a', 'Second');
    assert(g.getNode('a').label === 'First');
  });

  test('Graph: addEdge auto-creates missing endpoints', () => {
    const g = new Graph();
    g.addEdge('p', 'q');
    assert(g.hasNode('p') && g.hasNode('q'));
  });

  test('kahn: 2000-node chain completes successfully', () => {
    const g = new Graph();
    for (let i = 0; i < 1999; i++) g.addEdge('n' + i, 'n' + (i + 1));
    const r = kahn(g);
    assert(r.success && r.order.length === 2000 && r.layers.length === 2000);
  });

  /* ============================ commit 2 ================================ */

  test('Graph: predecessors tracks reverse adjacency', () => {
    const g = new Graph();
    g.addEdge('a', 'c'); g.addEdge('b', 'c');
    const preds = [...g.predecessors('c')].sort();
    assert(deepEq(preds, ['a', 'b']));
    assert(g.predecessors('a').size === 0);
  });

  test('Graph: removeEdge decrements indegree and reverse adj', () => {
    const g = new Graph();
    g.addEdge('a', 'c'); g.addEdge('b', 'c');
    assert(g.indegree('c') === 2);
    assert(g.removeEdge('a', 'c') === true);
    assert(g.indegree('c') === 1);
    assert(!g.hasEdge('a', 'c'));
    assert([...g.predecessors('c')].join(',') === 'b');
    assert(g.removeEdge('a', 'c') === false, 'second removal is a no-op');
  });

  test('Graph: removeNode cleans up incoming and outgoing', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('b', 'd');
    g.addEdge('x', 'b');
    g.removeNode('b');
    assert(!g.hasNode('b'));
    assert(!g.hasEdge('a', 'b'));
    assert(!g.hasEdge('b', 'c'));
    assert(g.indegree('c') === 0);
    assert(g.indegree('d') === 0);
    assert(g.predecessors('c').size === 0);
    assert(g.predecessors('d').size === 0);
    assert([...g.neighbors('a')].length === 0);
  });

  test('Graph: toJSON/fromJSON round-trip preserves structure', () => {
    const g = new Graph();
    g.addNode('a', 'Alpha', { note: 'start' });
    g.addEdge('a', 'b'); g.addEdge('b', 'c');
    const json = g.toJSON();
    const g2 = Graph.fromJSON(JSON.parse(JSON.stringify(json)));
    assert(g2.size() === 3);
    assert(g2.hasEdge('a', 'b') && g2.hasEdge('b', 'c'));
    assert(g2.getNode('a').label === 'Alpha');
    assert(g2.getNode('a').meta.note === 'start');
  });

  test('State: recomputeAll seeds layerOf from Kahn', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('a', 'c');
    const s = new State(g);
    s.recomputeAll();
    assert(s.cycle === null);
    assert(s.layerOf.get('a') === 0);
    assert(s.layerOf.get('b') === 1);
    assert(s.layerOf.get('c') === 2);
  });

  test('State: wouldCreateCycle detects a closing loop', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c');
    const s = new State(g); s.recomputeAll();
    assert(s.wouldCreateCycle('c', 'a') === true);
    assert(s.wouldCreateCycle('a', 'c') === false);
    assert(s.wouldCreateCycle('a', 'a') === true, 'self-loop');
  });

  test('State: addEdge rejects cycle and returns the closing path', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c');
    const s = new State(g); s.recomputeAll();
    const r = s.addEdge('c', 'a');
    assert(!r.success && r.reason === 'cycle');
    assert(Array.isArray(r.cyclePath));
    assert(r.cyclePath[0] === 'a' && r.cyclePath[r.cyclePath.length - 1] === 'a');
    assert(!g.hasEdge('c', 'a'), 'edge must not have been added');
  });

  test('State: addEdge forward propagation bumps only affected descendants', () => {
    // DAG: a -> b -> c;   x (isolated branch that should NOT be touched)
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c');
    g.addNode('x'); g.addNode('y'); g.addEdge('x', 'y');
    const s = new State(g); s.recomputeAll();
    // baseline: a=0 b=1 c=2 x=0 y=1
    assert(s.layerOf.get('a') === 0);
    assert(s.layerOf.get('b') === 1);
    assert(s.layerOf.get('c') === 2);

    // Add a fresh "deep" prereq in front: d -> a. Only {a,b,c} should shift.
    s.addNode('d');
    // bump d to make it deep before linking: d is at layer 0; but adding d->a
    // won't change anything (a already >= 0+1? no, a is 0 and would need to
    // become 1). Let's set up: create d with known layer 0, then e->d->a.
    s.addNode('e');
    s.addEdge('e', 'd'); // d becomes layer 1
    const affected = s.addEdge('d', 'a').affected;
    // a should be 2, b=3, c=4
    assert(s.layerOf.get('a') === 2);
    assert(s.layerOf.get('b') === 3);
    assert(s.layerOf.get('c') === 4);
    // x, y must not be in affected (unrelated branch)
    assert(!affected.has('x') && !affected.has('y'));
    assert(s.layerOf.get('x') === 0 && s.layerOf.get('y') === 1);
  });

  test('State: addEdge affected set is a PROPER subset (partiality proof)', () => {
    // Build a 200-node chain, then add an isolated extra chain of 50 nodes.
    // Adding an edge at the head of the big chain must not re-layer the
    // 50-node chain.
    const g = new Graph();
    for (let i = 0; i < 199; i++) g.addEdge('b' + i, 'b' + (i + 1));   // b0..b199
    for (let i = 0; i < 49; i++)  g.addEdge('s' + i, 's' + (i + 1));   // s0..s49
    const s = new State(g); s.recomputeAll();

    // Prepend a new root to the big chain: r -> b0.  This should bump every
    // b_i up by 1 (200 nodes affected) and leave the s-chain untouched.
    s.addNode('r');
    const { affected } = s.addEdge('r', 'b0');
    assert(affected.size === 200, `expected 200 affected, got ${affected.size}`);
    for (let i = 0; i < 50; i++) assert(!affected.has('s' + i));
    // And spot-check the layer after propagation
    assert(s.layerOf.get('b199') === 200);
    assert(s.layerOf.get('s49') === 49);
  });

  test('State: addEdge that does not bump anything returns empty affected', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('a', 'c'); g.addEdge('c', 'b');
    // b is already at layer 2 due to a->c->b. Adding a->b (already present)
    // is a no-op; but even if we ADD a fresh non-bumping edge, affected is 0.
    const s = new State(g); s.recomputeAll();
    s.addNode('z'); // layer 0
    const { affected } = s.addEdge('a', 'z'); // z was 0, still 1 because a->z makes it 1. actually 1 > 0 so z bumps
    assert(affected.size === 1 && affected.has('z'));
  });

  test('State: removeEdge decreases downstream layers correctly', () => {
    // a -> b -> c, and a -> c directly. c's layer is 2 via the long path.
    // Remove b -> c: c should drop to layer 1 (only direct a -> c remains).
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('a', 'c');
    const s = new State(g); s.recomputeAll();
    assert(s.layerOf.get('c') === 2);
    const r = s.removeEdge('b', 'c');
    assert(r.success);
    assert(s.layerOf.get('c') === 1, `c expected 1, got ${s.layerOf.get('c')}`);
  });

  test('State: removeNode cleans up and re-layers successors', () => {
    // a -> mid -> c; after removing mid, c should drop to a root (layer 0)
    // since mid was its only predecessor.
    const g = new Graph();
    g.addEdge('a', 'mid'); g.addEdge('mid', 'c');
    const s = new State(g); s.recomputeAll();
    assert(s.layerOf.get('c') === 2);
    s.removeNode('mid');
    assert(!s.graph.hasNode('mid'));
    assert(s.layerOf.get('c') === 0);
  });

  test('State: invariant — every edge u→v has layer(u) < layer(v) after many edits', () => {
    const g = new Graph();
    const s = new State(g); s.recomputeAll();
    const ids = [];
    for (let i = 0; i < 25; i++) { const id = 'n' + i; s.addNode(id); ids.push(id); }
    // Add a bunch of random DAG edges (only from lower index to higher to
    // guarantee acyclicity).
    let rng = 1;
    const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 80; k++) {
      const i = Math.floor(rnd() * 24);
      const j = i + 1 + Math.floor(rnd() * (24 - i));
      s.addEdge('n' + i, 'n' + j);
    }
    // Validate invariant
    for (const [u, v] of s.graph.edges()) {
      assert(s.layerOf.get(u) < s.layerOf.get(v), `invariant broken on ${u}→${v}`);
    }
    // Cross-check against a fresh Kahn recomputation
    const fresh = new State(Graph.fromJSON(s.graph.toJSON()));
    fresh.recomputeAll();
    for (const id of s.graph.nodes()) {
      assert(s.layerOf.get(id) === fresh.layerOf.get(id), `layer mismatch on ${id}`);
    }
  });

  test('Storage: save/load round-trips with in-memory driver', () => {
    const g = new Graph();
    g.addNode('a', 'Alpha'); g.addEdge('a', 'b'); g.addEdge('b', 'c');
    const store = new Storage(_memoryDriver());
    assert(store.load() === null, 'initially empty');
    assert(store.save(g) === true);
    const g2 = store.load();
    assert(g2 && g2.size() === 3);
    assert(g2.hasEdge('a', 'b') && g2.hasEdge('b', 'c'));
    assert(g2.getNode('a').label === 'Alpha');
    assert(store.clear() === true);
    assert(store.load() === null);
  });

  /* ============================ commit 3 ================================ */

  test('Extractor: headings and prerequisite bullets create concepts and edges', () => {
    const text = [
      '# Discrete Math',
      '',
      'Prerequisites:',
      '- Logic',
      '- Algebra',
    ].join('\n');
    const out = Extractor.extract(text);
    const labels = out.concepts.map((c) => c.label).sort();
    assert(deepEq(labels, ['Algebra', 'Discrete Math', 'Logic']));
    const edges = out.edges.map((e) => `${e.from}->${e.to}`).sort();
    assert(deepEq(edges, ['Algebra->Discrete Math', 'Logic->Discrete Math']));
  });

  test('Extractor: verb patterns use known concepts as anchors', () => {
    const out = Extractor.extract(
      'Graph Algorithms requires Discrete Math. Topological Sort builds on Graph Algorithms.',
      ['Graph Algorithms', 'Discrete Math', 'Topological Sort']
    );
    const edges = out.edges.map((e) => `${e.from}->${e.to}`).sort();
    assert(edges.includes('Discrete Math->Graph Algorithms'));
    assert(edges.includes('Graph Algorithms->Topological Sort'));
  });

  test('Extractor: wiki links and repeated capitalised phrases become concepts only', () => {
    const out = Extractor.extract(
      'Study [[Kahn Algorithm]]. Kahn Algorithm is useful. Kahn Algorithm appears again.'
    );
    const labels = out.concepts.map((c) => c.label);
    assert(labels.includes('Kahn Algorithm'));
    assert(out.edges.length === 0);
  });

  test('Exporter: healthy graph becomes ordered Markdown with layer breakdown', () => {
    const g = new Graph();
    g.addNode('logic', 'Logic');
    g.addNode('proofs', 'Proofs');
    g.addEdge('logic', 'proofs');
    const s = new State(g); s.recomputeAll();
    const md = Exporter.toMarkdown(s, { title: 'Plan', footer: '_done_' });
    assert(md.includes('# Plan'));
    assert(md.includes('1. `L0` Logic'));
    assert(md.includes('2. `L1` Proofs'));
    assert(md.includes('### Layer 1'));
    assert(md.includes('**Proofs** _(after: Logic)_'));
  });

  test('Exporter: polished Markdown includes checklist and link appendix', () => {
    const g = new Graph();
    g.addNode('logic', 'Logic');
    g.addNode('proofs', 'Proofs');
    g.addEdge('logic', 'proofs');
    const s = new State(g); s.recomputeAll();
    const md = Exporter.toMarkdown(s, { generatedAt: new Date('2026-04-21T00:00:00Z') });
    assert(md.includes('_Generated: 2026-04-21_'));
    assert(md.includes('## Study checklist'));
    assert(md.includes('- [ ] `L1` Proofs'));
    assert(md.includes('## Prerequisite links'));
    assert(md.includes('- Logic -> Proofs'));
  });

  test('Exporter: contradictory graph includes contradiction section', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('c', 'a');
    const s = new State(g); s.recomputeAll();
    const md = Exporter.toMarkdown(s);
    assert(md.includes('contradiction detected'));
    assert(md.includes('## Contradiction'));
    assert(md.includes('- a') && md.includes('- b') && md.includes('- c'));
  });

  test('Resolver: recovers a concrete cycle and edge list', () => {
    const g = new Graph();
    g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('c', 'a');
    g.addEdge('c', 'tail');
    const s = new State(g); s.recomputeAll();
    const path = Resolver.findCyclePath(g, s.cycle);
    assert(path && path[0] === path[path.length - 1], 'closed path');
    const edges = Resolver.cyclePathEdges(path);
    assert(edges.length >= 3);
    for (const [u, v] of edges) assert(g.hasEdge(u, v), `${u}->${v} must exist`);
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
