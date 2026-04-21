/**
 * App.js  (commit 3)
 *
 * Wires Graph + State + Canvas + Storage + Extractor + Exporter + Resolver
 * into the interactive offline demo.
 *
 *   - Graph auto-persists to localStorage on every mutation.
 *   - Import modal: paste or upload .txt/.md; offline extraction suggests
 *     concepts + edges; user ticks which ones to apply.
 *   - Export: downloads a Markdown mastery path with layer breakdown.
 *   - Resolve modal: when a cycle is detected, user picks an edge on the
 *     cycle to drop; incremental re-layering restores consistency.
 */
(function () {
  'use strict';

  const {
    Graph, State, Canvas, Storage, Extractor, Exporter, Resolver,
  } = window.ChainForge;

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

  function idFor(label) { return String(label).replace(/\s+/g, '_'); }

  document.addEventListener('DOMContentLoaded', () => {
    const storage = new Storage();

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
      // Keep the cycle status in sync after any mutation.
      state.cycle = null;
      for (const id of state.graph.nodes()) {
        if (!Number.isFinite(state.layerOf.get(id))) {
          state.cycle = state.cycle || [];
          state.cycle.push(id);
        }
      }
      canvas.render();
      renderStats();
      renderOrder();
      renderCycle();
    }

    function renderStats() {
      const s = document.getElementById('stats');
      const finite = [...state.layerOf.values()].filter(Number.isFinite);
      const layerCount = finite.length ? Math.max(...finite) + 1 : 0;
      s.innerHTML =
        `<span><b>${state.graph.size()}</b> concepts</span>` +
        `<span><b>${state.graph.edgeCount()}</b> prerequisite links</span>` +
        `<span><b>${layerCount}</b> BFS layers</span>` +
        `<span class="${state.cycle && state.cycle.length ? 'err' : 'ok'}">` +
          (state.cycle && state.cycle.length ? 'cycle detected' : 'consistent DAG') +
        `</span>`;
    }

    function renderOrder() {
      const ol = document.getElementById('order');
      ol.innerHTML = '';
      let count = 0;
      for (const id of state.topoOrder()) {
        const layer = state.layerOf.get(id);
        if (!Number.isFinite(layer)) continue;
        const label = state.graph.getNode(id)?.label || id;
        const li = document.createElement('li');
        li.innerHTML = `<span class="mono">L${layer}</span> <span>${escapeHtml(label)}</span>`;
        ol.appendChild(li);
        count++;
      }
      if (count === 0) ol.innerHTML = '<li class="empty">Graph is empty. Double-click the canvas, or click Import notes to extract concepts from your material.</li>';
    }

    function renderCycle() {
      const el = document.getElementById('cycle');
      if (state.cycle && state.cycle.length) {
        const labels = state.cycle
          .map((id) => state.graph.getNode(id)?.label || id)
          .slice(0, 6);
        const more = state.cycle.length > 6 ? ` … (+${state.cycle.length - 6} more)` : '';
        el.classList.remove('hidden');
        el.innerHTML =
          `<span>Contradiction — cycle involves: ${labels.map(escapeHtml).join(', ')}${more}</span>` +
          `<button id="resolve-btn" class="btn small danger">Resolve</button>`;
        document.getElementById('resolve-btn').addEventListener('click', openResolveModal);
      } else {
        el.classList.add('hidden');
        el.innerHTML = '';
      }
    }

    let toastTimer = null;
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('visible');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('visible'), 3000);
    }

    /* ------------------------- sidebar: quick add ----------------------- */

    document.getElementById('add-concept').addEventListener('click', () => {
      const input = document.getElementById('new-concept');
      const name = (input.value || '').trim();
      if (!name) return;
      const id = idFor(name);
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

    /* --------------------------- toolbar actions ------------------------ */

    document.getElementById('import-btn').addEventListener('click', openImportModal);
    document.getElementById('export-btn').addEventListener('click', exportMarkdown);
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

    /* ------------------------------- export ----------------------------- */

    function exportMarkdown() {
      const md = Exporter.toMarkdown(state);
      const ts = new Date().toISOString().slice(0, 10);
      Exporter.download(`chainforge-mastery-${ts}.md`, md);
      showToast('Mastery path exported.');
    }

    /* ------------------------------- import ----------------------------- */

    const importModal = document.getElementById('import-modal');
    const importText = document.getElementById('import-text');
    const importFile = document.getElementById('import-file');
    const importExtract = document.getElementById('import-extract');
    const importPreview = document.getElementById('import-preview');
    const importApply = document.getElementById('import-apply');
    const importClose = document.getElementById('import-close');
    let lastExtraction = null;

    function openImportModal() {
      importText.value = '';
      importPreview.innerHTML = '';
      importApply.disabled = true;
      lastExtraction = null;
      importModal.classList.remove('hidden');
      setTimeout(() => importText.focus(), 50);
    }
    function closeImportModal() { importModal.classList.add('hidden'); }
    importClose.addEventListener('click', closeImportModal);
    importModal.addEventListener('click', (e) => {
      if (e.target === importModal) closeImportModal();
    });

    importFile.addEventListener('change', () => {
      const f = importFile.files && importFile.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { importText.value = String(r.result || ''); };
      r.readAsText(f);
    });

    importExtract.addEventListener('click', () => {
      const text = importText.value || '';
      if (!text.trim()) { showToast('Paste some notes or choose a file first.'); return; }
      const known = [];
      for (const id of state.graph.nodes()) {
        known.push(state.graph.getNode(id)?.label || id);
      }
      const res = Extractor.extract(text, known);
      lastExtraction = res;
      renderPreview(res);
    });

    function renderPreview({ concepts, edges }) {
      importPreview.innerHTML = '';
      if (!concepts.length && !edges.length) {
        importPreview.innerHTML = '<p class="muted empty">No concepts or prerequisite clues found. Try content with headings, a "Prerequisites:" section, or phrases like "X requires Y".</p>';
        importApply.disabled = true;
        return;
      }
      // Concepts panel
      const existingLabels = new Set();
      for (const id of state.graph.nodes()) existingLabels.add(state.graph.getNode(id)?.label || id);

      const newConcepts = concepts.filter((c) => !existingLabels.has(c.label));
      const section1 = document.createElement('section');
      section1.innerHTML = `<h3>New concepts <span class="count">${newConcepts.length}</span></h3>`;
      if (!newConcepts.length) {
        const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No new concepts — everything detected is already in your graph.';
        section1.appendChild(p);
      } else {
        const ul = document.createElement('ul'); ul.className = 'preview-list';
        for (const c of newConcepts) {
          const li = document.createElement('li');
          li.innerHTML = `
            <label>
              <input type="checkbox" data-kind="concept" data-label="${escapeAttr(c.label)}" checked />
              <span class="lbl">${escapeHtml(c.label)}</span>
              <span class="src">${escapeHtml(c.source)}</span>
            </label>`;
          ul.appendChild(li);
        }
        section1.appendChild(ul);
      }
      importPreview.appendChild(section1);

      // Edges panel (suggest all; filter out ones that would be duplicates)
      const newEdges = edges.filter((e) => {
        const uId = idFor(e.from), vId = idFor(e.to);
        return !state.graph.hasEdge(uId, vId);
      });
      const section2 = document.createElement('section');
      section2.innerHTML = `<h3>New prerequisite edges <span class="count">${newEdges.length}</span></h3>`;
      if (!newEdges.length) {
        const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No new edges — nothing to wire up.';
        section2.appendChild(p);
      } else {
        const ul = document.createElement('ul'); ul.className = 'preview-list';
        for (const e of newEdges) {
          const li = document.createElement('li');
          li.innerHTML = `
            <label>
              <input type="checkbox" data-kind="edge"
                data-from="${escapeAttr(e.from)}" data-to="${escapeAttr(e.to)}" checked />
              <span class="lbl"><b>${escapeHtml(e.from)}</b> <span class="arrow">→</span> <b>${escapeHtml(e.to)}</b></span>
              <span class="src">${escapeHtml(e.source)}</span>
            </label>`;
          ul.appendChild(li);
        }
        section2.appendChild(ul);
      }
      importPreview.appendChild(section2);
      importApply.disabled = false;
    }

    importApply.addEventListener('click', () => {
      if (!lastExtraction) return;
      const checks = importPreview.querySelectorAll('input[type="checkbox"]:checked');
      let addedNodes = 0, addedEdges = 0, contradictions = 0;
      // Apply concepts first
      for (const c of checks) {
        if (c.dataset.kind === 'concept') {
          const label = c.dataset.label;
          const id = idFor(label);
          if (!state.graph.hasNode(id)) { state.addNode(id, label); addedNodes++; }
        }
      }
      // Then edges
      for (const c of checks) {
        if (c.dataset.kind === 'edge') {
          const u = idFor(c.dataset.from), v = idFor(c.dataset.to);
          // Auto-create endpoints if user deselected their concept but kept an edge
          if (!state.graph.hasNode(u)) state.addNode(u, c.dataset.from);
          if (!state.graph.hasNode(v)) state.addNode(v, c.dataset.to);
          const r = state.addEdge(u, v);
          if (r.success && !r.noop) addedEdges++;
          else if (!r.success && r.reason === 'cycle') {
            // Imported material can legitimately disagree with itself. Keep
            // the contradictory edge so Kahn flags it and the resolver can
            // offer a concrete edge to drop.
            if (state.graph.addEdge(u, v)) contradictions++;
          }
        }
      }
      if (contradictions) state.recomputeAll();
      closeImportModal();
      refresh();
      storage.save(state.graph);
      const bits = [];
      if (addedNodes) bits.push(`${addedNodes} concept${addedNodes === 1 ? '' : 's'}`);
      if (addedEdges) bits.push(`${addedEdges} edge${addedEdges === 1 ? '' : 's'}`);
      if (contradictions) bits.push(`${contradictions} contradiction${contradictions === 1 ? '' : 's'} to resolve`);
      showToast('Imported: ' + (bits.join(', ') || 'nothing new'));
    });

    /* --------------------------- resolver modal ------------------------- */

    const resolveModal = document.getElementById('resolve-modal');
    const resolveList = document.getElementById('resolve-list');
    const resolveClose = document.getElementById('resolve-close');
    resolveClose.addEventListener('click', () => resolveModal.classList.add('hidden'));
    resolveModal.addEventListener('click', (e) => {
      if (e.target === resolveModal) resolveModal.classList.add('hidden');
    });

    function openResolveModal() {
      const path = Resolver.findCyclePath(state.graph, state.cycle || []);
      resolveList.innerHTML = '';
      if (!path || path.length < 2) {
        resolveList.innerHTML = '<p class="muted">No concrete cycle could be recovered. Try removing any edge connected to the flagged concepts.</p>';
        resolveModal.classList.remove('hidden');
        return;
      }
      const labelOf = (id) => state.graph.getNode(id)?.label || id;
      const header = document.createElement('p');
      header.innerHTML = `<b>Cycle:</b> ${path.map(labelOf).map(escapeHtml).join(' → ')}`;
      resolveList.appendChild(header);

      const ul = document.createElement('ul'); ul.className = 'preview-list';
      const edges = Resolver.cyclePathEdges(path);
      for (const [u, v] of edges) {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="lbl"><b>${escapeHtml(labelOf(u))}</b> → <b>${escapeHtml(labelOf(v))}</b></span>
          <button class="btn small danger">Drop this edge</button>`;
        li.querySelector('button').addEventListener('click', () => {
          state.removeEdge(u, v);
          // If any leftover cycle nodes remain, they'll re-trigger; recompute
          // to settle cycle set after removal.
          state.recomputeAll();
          resolveModal.classList.add('hidden');
          refresh();
          storage.save(state.graph);
          showToast(`Dropped ${labelOf(u)} → ${labelOf(v)}. Contradiction resolved${state.cycle && state.cycle.length ? ' partially.' : '.'}`);
        });
        ul.appendChild(li);
      }
      resolveList.appendChild(ul);
      resolveModal.classList.remove('hidden');
    }

    /* --------------------------- tiny helpers --------------------------- */

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escapeAttr(s) {
      return escapeHtml(s).replace(/"/g, '&quot;');
    }

    refresh();
  });
})();
