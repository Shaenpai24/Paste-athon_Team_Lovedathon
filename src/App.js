/**
 * App.js — demo wiring for the initial commit.
 *
 * Shows ChainForge running Kahn's algorithm on a small, hard-coded course DAG
 * (drawn from a typical CS curriculum) so the reviewer can open index.html
 * offline and immediately see: a topological order, the BFS layers, and
 * (toggled on) an injected cycle being flagged.
 *
 * Document ingestion, an interactive canvas, and persistence arrive in the
 * next commits per the roadmap in README.md.
 */
(function () {
  'use strict';

  const { Graph, kahn } = window.ChainForge;

  // --- Demo DAG: a small "foundations for algorithms" curriculum. ---------
  // Edge u -> v means "u must be learned before v".
  const demoEdges = [
    ['Arithmetic',          'Algebra'],
    ['Algebra',             'Functions'],
    ['Functions',           'Calculus I'],
    ['Arithmetic',          'Logic'],
    ['Logic',               'Proofs'],
    ['Proofs',              'Discrete Math'],
    ['Algebra',             'Discrete Math'],
    ['Discrete Math',       'Data Structures'],
    ['Calculus I',          'Probability'],
    ['Discrete Math',       'Probability'],
    ['Data Structures',     'Graph Algorithms'],
    ['Probability',         'Graph Algorithms'],
    ['Graph Algorithms',    'Topological Sort'],
    ['Data Structures',     'Topological Sort'],
  ];

  function buildDemoGraph() {
    const g = new Graph();
    for (const [u, v] of demoEdges) g.addEdge(u, v);
    return g;
  }

  function render(result, graph) {
    const stats = document.getElementById('stats');
    stats.innerHTML =
      `<span><b>${graph.size()}</b> concepts</span>` +
      `<span><b>${graph.edgeCount()}</b> prerequisite links</span>` +
      `<span><b>${result.layers.length}</b> BFS layers</span>` +
      `<span class="${result.success ? 'ok' : 'err'}">` +
        (result.success ? 'consistent DAG' : 'cycle detected') +
      `</span>`;

    const orderEl = document.getElementById('order');
    orderEl.innerHTML = '';
    result.order.forEach((id, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${id}`;
      orderEl.appendChild(li);
    });

    const layersEl = document.getElementById('layers');
    layersEl.innerHTML = '';
    result.layers.forEach((layer, i) => {
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `<div class="layer-idx">L${i}</div>`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const id of layer) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = id;
        chips.appendChild(chip);
      }
      row.appendChild(chips);
      layersEl.appendChild(row);
    });

    const cycleEl = document.getElementById('cycle');
    if (result.success) {
      cycleEl.classList.add('hidden');
      cycleEl.textContent = '';
    } else {
      cycleEl.classList.remove('hidden');
      cycleEl.textContent =
        'Contradiction in the field — these concepts form a cycle: ' +
        result.cycleNodes.join(', ');
    }
  }

  function runHealthy() {
    const g = buildDemoGraph();
    render(kahn(g), g);
  }

  function runWithCycle() {
    const g = buildDemoGraph();
    // Inject a contradiction: "Topological Sort -> Arithmetic" closes a loop.
    g.addEdge('Topological Sort', 'Arithmetic');
    render(kahn(g), g);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('run-healthy').addEventListener('click', runHealthy);
    document.getElementById('run-cycle').addEventListener('click', runWithCycle);
    runHealthy();
  });
})();
