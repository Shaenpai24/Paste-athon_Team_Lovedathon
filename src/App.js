/**
 * App.js  (commit 2)
 *
 * Wires Graph + State + Canvas + Storage together into the interactive
 * offline demo. Graph is auto-persisted to localStorage on every mutation;
 * if no saved graph exists, a demo curriculum is seeded on first load.
 */
(function () {
  'use strict';

  const { Graph, State, Canvas, Storage } = window.ChainForge;

  const DEMO_EDGES = [
    ['Arithmetic',       'Algebra'],
    ['Algebra',          'Functions'],
    ['Functions',        'Calculus I'],
    ['Arithmetic',       'Logic'],
    ['Logic',            'Proofs'],
    ['Proofs',           'Discrete Math'],
    ['Algebra',          'Discrete Math'],
    ['Discrete Math',    'Data Structures'],
    ['Calculus I',       'Probability'],
    ['Discrete Math',    'Probability'],
    ['Data Structures',  'Graph Algorithms'],
    ['Probability',      'Graph Algorithms'],
    ['Graph Algorithms', 'Topological Sort'],
    ['Data Structures',  'Topological Sort'],
  ];

  function seedDemo() {
    const g = new Graph();
    for (const [u, v] of DEMO_EDGES) g.addEdge(u, v);
    return g;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const storage = new Storage();

    // Initial graph: from localStorage, else demo.
    let graph = storage.load();
    if (!graph || graph.size() === 0) graph = seedDemo();

    const state = new State(graph);
    state.recomputeAll();

    const svg = document.getElementById('canvas');
    const canvas = new Canvas(svg, state, {
      onToast: showToast,
      onMutate: () => { refresh(); storage.save(state.graph); },
    });

    function refresh() {
      canvas.render();
      renderStats();
      renderOrder();
      renderCycle();
    }

    function renderStats() {
      const s = document.getElementById('stats');
      const finiteLayers = [...state.layerOf.values()].filter(Number.isFinite);
      const layerCount = finiteLayers.length
        ? Math.max(...finiteLayers) + 1
        : 0;
      s.innerHTML =
        `<span><b>${state.graph.size()}</b> concepts</span>` +
        `<span><b>${state.graph.edgeCount()}</b> prerequisite links</span>` +
        `<span><b>${layerCount}</b> BFS layers</span>` +
        `<span class="${state.cycle ? 'err' : 'ok'}">` +
          (state.cycle ? 'cycle detected' : 'consistent DAG') +
        `</span>`;
    }

    function renderOrder() {
      const ol = document.getElementById('order');
      ol.innerHTML = '';
      const order = state.topoOrder();
      let i = 1;
      for (const id of order) {
        if (!Number.isFinite(state.layerOf.get(id))) continue;
        const li = document.createElement('li');
        const label = state.graph.getNode(id)?.label || id;
        li.innerHTML = `<span class="mono">L${state.layerOf.get(id)}</span> ${label}`;
        ol.appendChild(li);
        i++;
      }
      if (i === 1) ol.innerHTML = '<li class="empty">Graph is empty. Double-click the canvas to add a concept.</li>';
    }

    function renderCycle() {
      const el = document.getElementById('cycle');
      if (state.cycle && state.cycle.length) {
        el.classList.remove('hidden');
        const labels = state.cycle.map(id => state.graph.getNode(id)?.label || id);
        el.textContent = 'Contradiction — concepts on a cycle: ' + labels.join(', ');
      } else {
        el.classList.add('hidden');
        el.textContent = '';
      }
    }

    let toastTimer = null;
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('visible');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('visible'), 2800);
    }

    // Toolbar
    document.getElementById('add-concept').addEventListener('click', () => {
      const input = document.getElementById('new-concept');
      const name = (input.value || '').trim();
      if (!name) return;
      const id = name.replace(/\s+/g, '_');
      if (state.graph.hasNode(id)) {
        showToast(`"${name}" already exists.`);
        return;
      }
      state.addNode(id, name);
      input.value = '';
      refresh();
      storage.save(state.graph);
    });
    document.getElementById('new-concept').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('add-concept').click();
    });
    document.getElementById('reset-demo').addEventListener('click', () => {
      if (!confirm('Replace the current graph with the demo curriculum?')) return;
      state.graph = seedDemo();
      state.recomputeAll();
      canvas.state = state;
      refresh();
      storage.save(state.graph);
    });
    document.getElementById('clear-all').addEventListener('click', () => {
      if (!confirm('Delete every concept?')) return;
      state.graph = new Graph();
      state.layerOf = new Map();
      state.cycle = null;
      canvas.state = state;
      canvas.selected = null;
      refresh();
      storage.save(state.graph);
    });

    refresh();
  });
})();
