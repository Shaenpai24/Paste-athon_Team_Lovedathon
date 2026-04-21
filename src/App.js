/**
 * App.js  (commit 2)
 *
 * Wires Graph + State + Canvas + Storage together into the interactive
 * offline demo. Graph is auto-persisted to localStorage on every mutation;
 * if no saved graph exists, a demo curriculum is seeded on first load.
 */
(function () {
  'use strict';

  const { Graph, State, Canvas, Storage, extractFromText } = window.ChainForge;

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
    let analyzedDoc = null;

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
      renderSelectedNodeTitle();
      renderSubjectInfo();
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

    function setImportSummary(msg, isError = false) {
      const el = document.getElementById('import-summary');
      el.textContent = msg;
      el.classList.toggle('err-text', !!isError);
    }

    function getDocText() {
      return (document.getElementById('doc-text').value || '').trim();
    }

    function analyzeText(text) {
      if (!text) {
        analyzedDoc = null;
        setImportSummary('Paste notes or choose a file before analyzing.', true);
        return null;
      }
      analyzedDoc = extractFromText(text);
      const c = analyzedDoc.concepts.length;
      const e = analyzedDoc.edges.length;
      const ignored = analyzedDoc.ignoredRelations;
      setImportSummary(`Extracted ${c} concepts, ${e} links. ${ignored} relation${ignored === 1 ? '' : 's'} ignored.`);
      return analyzedDoc;
    }

    function applyImport(parsed, replaceAll) {
      if (!parsed) {
        showToast('Analyze a document first.');
        return;
      }

      if (replaceAll) {
        state.graph = new Graph();
        state.layerOf = new Map();
        state.cycle = null;
        canvas.state = state;
        canvas.selected = null;
      }

      let addedNodes = 0;
      let addedEdges = 0;
      let rejectedCycles = 0;

      for (const n of parsed.concepts) {
        if (!state.graph.hasNode(n.id)) {
          state.addNode(n.id, n.label);
          addedNodes++;
        }
        if (n.note) {
          const node = state.graph.getNode(n.id);
          node.meta = node.meta || {};
          if (!node.meta.note) node.meta.note = n.note;
        }
      }

      for (const [u, v] of parsed.edges) {
        const r = state.addEdge(u, v);
        if (r.success && !r.noop) addedEdges++;
        if (!r.success && r.reason === 'cycle') rejectedCycles++;
      }

      state.recomputeAll();
      refresh();
      storage.save(state.graph);

      showToast(
        `Import complete: +${addedNodes} concepts, +${addedEdges} links` +
        (rejectedCycles ? `, ${rejectedCycles} cycle rejection${rejectedCycles === 1 ? '' : 's'}` : '') +
        '.'
      );
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

    function selectedNodeId() {
      return canvas.selected && canvas.selected.type === 'node'
        ? canvas.selected.id
        : null;
    }

    function nodeLabel(id) {
      return state.graph.getNode(id)?.label || id;
    }

    function quickNoteDraft(id, inIds, outIds) {
      const title = nodeLabel(id);
      const prereqText = inIds.length ? inIds.map(nodeLabel).join(', ') : 'None';
      const outText = outIds.length ? outIds.map(nodeLabel).join(', ') : 'None';
      return (
        `Topic: ${title}\n` +
        `What it is:\n- \n\n` +
        `Why it matters:\n- \n\n` +
        `Prerequisites:\n- ${prereqText}\n\n` +
        `Used for:\n- ${outText}`
      );
    }

    function renderSubjectInfo() {
      const selectedId = selectedNodeId();
      const empty = document.getElementById('subject-empty');
      const info = document.getElementById('subject-info');
      const title = document.getElementById('subject-title');
      const meta = document.getElementById('subject-meta');
      const prereqs = document.getElementById('subject-prereqs');
      const dependents = document.getElementById('subject-dependents');
      const note = document.getElementById('subject-note');

      if (!selectedId || !state.graph.hasNode(selectedId)) {
        empty.classList.remove('hidden');
        info.classList.add('hidden');
        return;
      }

      const layer = state.layerOf.get(selectedId);
      const inIds = [...state.graph.predecessors(selectedId)];
      const outIds = [...state.graph.neighbors(selectedId)];
      inIds.sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));
      outIds.sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));

      empty.classList.add('hidden');
      info.classList.remove('hidden');
      title.textContent = nodeLabel(selectedId);
      meta.textContent =
        `Layer: ${Number.isFinite(layer) ? 'L' + layer : 'Cycle'}  |  ` +
        `Prerequisites: ${inIds.length}  |  Unlocks: ${outIds.length}`;
      prereqs.textContent =
        'Needs: ' + (inIds.length ? inIds.map(nodeLabel).join(', ') : 'None');
      dependents.textContent =
        'Helps with: ' + (outIds.length ? outIds.map(nodeLabel).join(', ') : 'None');
      const saved = state.graph.getNode(selectedId)?.meta?.note || '';
      note.value = saved || quickNoteDraft(selectedId, inIds, outIds);
    }

    function renderSelectedNodeTitle() {
      const selectedId = selectedNodeId();
      const titleEl = document.getElementById('selected-node-title');
      if (!selectedId || !state.graph.hasNode(selectedId)) {
        titleEl.textContent = 'None';
        return;
      }
      titleEl.textContent = nodeLabel(selectedId);
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

    document.getElementById('doc-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        document.getElementById('doc-text').value = text;
        analyzeText(text);
        showToast(`Loaded ${file.name}.`);
      } catch (_) {
        setImportSummary('Could not read the selected file.', true);
      }
    });

    document.getElementById('analyze-doc').addEventListener('click', () => {
      analyzeText(getDocText());
    });

    document.getElementById('merge-doc').addEventListener('click', () => {
      const parsed = analyzedDoc || analyzeText(getDocText());
      applyImport(parsed, false);
    });

    document.getElementById('replace-doc').addEventListener('click', () => {
      const parsed = analyzedDoc || analyzeText(getDocText());
      if (!parsed) return;
      if (!confirm('Replace the current graph with concepts extracted from this document?')) return;
      applyImport(parsed, true);
    });

    document.getElementById('auto-layout').addEventListener('click', () => {
      canvas.autoLayout();
      showToast('Auto layout restored layer-based placement.');
    });

    document.getElementById('reset-view').addEventListener('click', () => {
      canvas.resetView();
      showToast('View reset.');
    });

    document.getElementById('save-note').addEventListener('click', () => {
      const selectedId = selectedNodeId();
      if (!selectedId || !state.graph.hasNode(selectedId)) {
        showToast('Select a concept first.');
        return;
      }
      const n = state.graph.getNode(selectedId);
      n.meta = n.meta || {};
      n.meta.note = (document.getElementById('subject-note').value || '').trim();
      storage.save(state.graph);
      renderSubjectInfo();
      showToast('Quick note saved.');
    });

    document.getElementById('clear-note').addEventListener('click', () => {
      const selectedId = selectedNodeId();
      if (!selectedId || !state.graph.hasNode(selectedId)) {
        showToast('Select a concept first.');
        return;
      }
      const n = state.graph.getNode(selectedId);
      if (n.meta && 'note' in n.meta) delete n.meta.note;
      document.getElementById('subject-note').value = '';
      storage.save(state.graph);
      renderSubjectInfo();
      showToast('Quick note cleared.');
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
