/**
 * Canvas.js  (commit 2)
 * -----------------------------------------------------------------------------
 * SVG renderer + interaction layer for the live dependency graph.
 *
 * Layout:
 *   Nodes are grouped by `state.layerOf` and drawn in columns — one column
 *   per BFS layer. Within a column they are sorted by label. Cycle nodes
 *   (layer = Infinity) are piled into a dedicated rightmost "contradiction"
 *   column.
 *
 * Interactions:
 *   - Double-click empty canvas     → add new concept (prompt for label)
 *   - Drag the "⦿" port on the right side of a node → drop on another node
 *                                      to add a prerequisite edge (live
 *                                      partial BFS re-layering runs on drop)
 *   - Click a node                  → select (Delete key removes it)
 *   - Click an edge's midpoint "×"  → remove edge
 *
 * No external libraries; raw SVG + pointer events, so it runs from file://
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const DEFAULTS = {
    columnWidth: 200,
    rowHeight: 64,
    nodeWidth: 150,
    nodeHeight: 40,
    padX: 40,
    padY: 40,
    cyclePadX: 60,
  };

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  class Canvas {
    constructor(svg, state, opts = {}) {
      this.svg = svg;
      this.state = state;
      this.o = Object.assign({}, DEFAULTS, opts);
      this.positions = new Map();
      this.selected = null;      // { type: 'node' | 'edge', id | [u,v] }
      this.drag = null;          // { from, pointerId, tmpLine }
      this.onToast = opts.onToast || (() => {});
      this.onMutate = opts.onMutate || (() => {});
      this._defs();
      this._bind();
    }

    /* ------------------------------ layout ------------------------------- */

    render() {
      this._layout();
      this._draw();
    }

    _layout() {
      const healthy = new Map(); // layer -> id[]
      const cycle = [];
      for (const [id, layer] of this.state.layerOf) {
        if (!Number.isFinite(layer)) { cycle.push(id); continue; }
        if (!healthy.has(layer)) healthy.set(layer, []);
        healthy.get(layer).push(id);
      }
      const labelOf = (id) =>
        (this.state.graph.getNode(id)?.label || id).toLowerCase();
      for (const ids of healthy.values()) {
        ids.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
      }
      cycle.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

      this.positions.clear();
      const maxLayer = healthy.size
        ? Math.max(...[...healthy.keys()])
        : -1;
      for (const [layer, ids] of healthy) {
        ids.forEach((id, row) => {
          this.positions.set(id, {
            x: this.o.padX + layer * this.o.columnWidth,
            y: this.o.padY + row * this.o.rowHeight,
          });
        });
      }
      // Cycle column at the far right (or beside layer 0 if empty graph)
      const cycleColX =
        this.o.padX + (maxLayer + 1) * this.o.columnWidth + this.o.cyclePadX;
      cycle.forEach((id, row) => {
        this.positions.set(id, {
          x: cycleColX,
          y: this.o.padY + row * this.o.rowHeight,
          cycle: true,
        });
      });

      // Size the SVG viewport to fit content
      const maxX = Math.max(
        cycle.length ? cycleColX + this.o.nodeWidth : 0,
        healthy.size
          ? this.o.padX + maxLayer * this.o.columnWidth + this.o.nodeWidth
          : 320
      );
      const maxRows = Math.max(
        cycle.length,
        ...([...healthy.values()].map((a) => a.length).concat([1]))
      );
      const maxY = this.o.padY + maxRows * this.o.rowHeight;
      this.svg.setAttribute('viewBox', `0 0 ${maxX + this.o.padX} ${maxY + 40}`);
      this.svg.style.minHeight = (maxY + 40) + 'px';
    }

    /* ------------------------------- draw -------------------------------- */

    _defs() {
      // Arrowhead marker, added once.
      const defs = svgEl('defs');
      const marker = svgEl('marker', {
        id: 'cf-arrow',
        viewBox: '0 0 10 10',
        refX: '9', refY: '5',
        markerWidth: '7', markerHeight: '7',
        orient: 'auto-start-reverse',
      });
      marker.appendChild(svgEl('path', {
        d: 'M 0 0 L 10 5 L 0 10 z',
        fill: '#5a8bbf',
      }));
      defs.appendChild(marker);
      this.svg.appendChild(defs);
    }

    _draw() {
      // Clear everything except <defs>
      [...this.svg.childNodes].forEach((n) => {
        if (n.tagName !== 'defs') this.svg.removeChild(n);
      });

      const edgeLayer = svgEl('g', { class: 'edges' });
      const nodeLayer = svgEl('g', { class: 'nodes' });
      this.svg.appendChild(edgeLayer);
      this.svg.appendChild(nodeLayer);

      // Edges
      for (const [u, v] of this.state.graph.edges()) {
        const pu = this.positions.get(u);
        const pv = this.positions.get(v);
        if (!pu || !pv) continue;
        const x1 = pu.x + this.o.nodeWidth;
        const y1 = pu.y + this.o.nodeHeight / 2;
        const x2 = pv.x;
        const y2 = pv.y + this.o.nodeHeight / 2;
        const mx = (x1 + x2) / 2;
        const path = svgEl('path', {
          d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
          class: 'edge',
          'marker-end': 'url(#cf-arrow)',
        });
        path.dataset.u = u;
        path.dataset.v = v;
        path.addEventListener('click', (e) => {
          e.stopPropagation();
          this._selectEdge(u, v);
        });
        edgeLayer.appendChild(path);

        // X button when selected
        if (this._isEdgeSelected(u, v)) {
          const cx = (x1 + x2) / 2;
          const cy = (y1 + y2) / 2;
          const btn = svgEl('g', { class: 'edge-del', transform: `translate(${cx},${cy})` });
          btn.appendChild(svgEl('circle', { r: 10, fill: '#1d212a', stroke: '#ff7a7a' }));
          const x = svgEl('text', {
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            fill: '#ff7a7a',
            'font-size': '13',
            'font-weight': '700',
          });
          x.textContent = '×';
          btn.appendChild(x);
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.state.removeEdge(u, v);
            this.selected = null;
            this.onMutate();
          });
          edgeLayer.appendChild(btn);
        }
      }

      // Nodes
      for (const [id, p] of this.positions) {
        const node = this.state.graph.getNode(id);
        if (!node) continue;
        const g = svgEl('g', {
          class:
            'node' +
            (p.cycle ? ' cycle' : '') +
            (this._isNodeSelected(id) ? ' selected' : ''),
          transform: `translate(${p.x},${p.y})`,
        });
        g.appendChild(svgEl('rect', {
          width: this.o.nodeWidth,
          height: this.o.nodeHeight,
          rx: 10, ry: 10,
          class: 'node-box',
        }));
        const t = svgEl('text', {
          x: 12,
          y: this.o.nodeHeight / 2,
          'dominant-baseline': 'central',
          class: 'node-label',
        });
        t.textContent = truncate(node.label, 18);
        g.appendChild(t);

        // Layer badge (tiny)
        if (!p.cycle) {
          const badge = svgEl('text', {
            x: this.o.nodeWidth - 10,
            y: this.o.nodeHeight / 2,
            'text-anchor': 'end',
            'dominant-baseline': 'central',
            class: 'node-layer',
          });
          badge.textContent = 'L' + this.state.layerOf.get(id);
          g.appendChild(badge);
        }

        // Port (drag handle) — right edge
        const port = svgEl('circle', {
          cx: this.o.nodeWidth,
          cy: this.o.nodeHeight / 2,
          r: 6,
          class: 'port',
        });
        port.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this._startEdgeDrag(id, e);
        });
        g.appendChild(port);

        g.addEventListener('click', (e) => {
          e.stopPropagation();
          this._selectNode(id);
        });
        nodeLayer.appendChild(g);
      }
    }

    /* ----------------------------- selection ----------------------------- */

    _selectNode(id) {
      this.selected = { type: 'node', id };
      this.onMutate(); // re-render
    }
    _selectEdge(u, v) {
      this.selected = { type: 'edge', edge: [u, v] };
      this.onMutate();
    }
    _isNodeSelected(id) {
      return this.selected && this.selected.type === 'node' && this.selected.id === id;
    }
    _isEdgeSelected(u, v) {
      return (
        this.selected &&
        this.selected.type === 'edge' &&
        this.selected.edge[0] === u &&
        this.selected.edge[1] === v
      );
    }

    /* --------------------------- edge-drag flow -------------------------- */

    _startEdgeDrag(fromId, evt) {
      this.svg.setPointerCapture(evt.pointerId);
      const pu = this.positions.get(fromId);
      const x1 = pu.x + this.o.nodeWidth;
      const y1 = pu.y + this.o.nodeHeight / 2;
      const line = svgEl('path', {
        d: `M ${x1} ${y1} L ${x1} ${y1}`,
        class: 'edge ghost',
      });
      this.svg.appendChild(line);
      this.drag = { from: fromId, pointerId: evt.pointerId, tmpLine: line, x1, y1 };
    }

    _onPointerMove(evt) {
      if (!this.drag || evt.pointerId !== this.drag.pointerId) return;
      const pt = this._clientToSvg(evt);
      const { x1, y1 } = this.drag;
      const mx = (x1 + pt.x) / 2;
      this.drag.tmpLine.setAttribute(
        'd',
        `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${pt.y}, ${pt.x} ${pt.y}`
      );
    }

    _onPointerUp(evt) {
      if (!this.drag || evt.pointerId !== this.drag.pointerId) return;
      const target = this._nodeAt(evt);
      const from = this.drag.from;
      this.drag.tmpLine.remove();
      try { this.svg.releasePointerCapture(evt.pointerId); } catch (_) {}
      this.drag = null;

      if (!target || target === from) { this.onMutate(); return; }
      const res = this.state.addEdge(from, target);
      if (!res.success && res.reason === 'cycle') {
        const path = res.cyclePath || [from, target];
        this.onToast(
          'Cycle rejected: adding this edge would create the loop  ' +
          path.map((id) => this._labelOf(id)).join(' → ')
        );
      } else if (res.success) {
        const n = res.affected ? res.affected.size : 0;
        this.onToast(
          `Edge added. Re-layered ${n} concept${n === 1 ? '' : 's'} (partial BFS).`
        );
      }
      this.onMutate();
    }

    _nodeAt(evt) {
      const pt = this._clientToSvg(evt);
      for (const [id, p] of this.positions) {
        if (
          pt.x >= p.x && pt.x <= p.x + this.o.nodeWidth &&
          pt.y >= p.y && pt.y <= p.y + this.o.nodeHeight
        ) return id;
      }
      return null;
    }

    _clientToSvg(evt) {
      const svgPt = this.svg.createSVGPoint();
      svgPt.x = evt.clientX;
      svgPt.y = evt.clientY;
      const m = this.svg.getScreenCTM();
      if (!m) return { x: evt.clientX, y: evt.clientY };
      const inv = m.inverse();
      const p = svgPt.matrixTransform(inv);
      return { x: p.x, y: p.y };
    }

    /* ------------------------------ events ------------------------------- */

    _bind() {
      this.svg.addEventListener('pointermove', (e) => this._onPointerMove(e));
      this.svg.addEventListener('pointerup', (e) => this._onPointerUp(e));
      this.svg.addEventListener('pointercancel', (e) => this._onPointerUp(e));

      this.svg.addEventListener('click', () => {
        // Click on empty canvas clears selection.
        if (this.selected) { this.selected = null; this.onMutate(); }
      });
      this.svg.addEventListener('dblclick', (e) => {
        const name = (prompt('New concept name:') || '').trim();
        if (!name) return;
        const id = this._uniqueId(name);
        this.state.addNode(id, name);
        this.onMutate();
      });

      // Keyboard Delete removes the selected node or edge
      document.addEventListener('keydown', (e) => {
        if (!this.selected) return;
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        if (this.selected.type === 'node') this.state.removeNode(this.selected.id);
        else if (this.selected.type === 'edge') {
          const [u, v] = this.selected.edge;
          this.state.removeEdge(u, v);
        }
        this.selected = null;
        this.onMutate();
      });
    }

    _labelOf(id) {
      return (this.state.graph.getNode(id)?.label) || id;
    }

    _uniqueId(label) {
      let base = label.replace(/\s+/g, '_');
      if (!this.state.graph.hasNode(base)) return base;
      let i = 2;
      while (this.state.graph.hasNode(base + '_' + i)) i++;
      return base + '_' + i;
    }
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  global.ChainForge.Canvas = Canvas;
})(typeof window !== 'undefined' ? window : globalThis);
