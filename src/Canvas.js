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
      this.nodeDrag = null;      // { id, pointerId, dx, dy, moved }
      this.panDrag = null;       // { pointerId, x, y }
      this.camera = { x: 0, y: 0, scale: 1 };
      this.contentBounds = { width: 400, height: 300 };
      this.scene = null;
      this.edgeLayer = null;
      this.nodeLayer = null;
      this.overlayLayer = null;
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

      const autoPositions = new Map();
      const maxLayer = healthy.size
        ? Math.max(...[...healthy.keys()])
        : -1;
      for (const [layer, ids] of healthy) {
        ids.forEach((id, row) => {
          autoPositions.set(id, {
            x: this.o.padX + layer * this.o.columnWidth,
            y: this.o.padY + row * this.o.rowHeight,
          });
        });
      }
      // Cycle column at the far right (or beside layer 0 if empty graph)
      const cycleColX =
        this.o.padX + (maxLayer + 1) * this.o.columnWidth + this.o.cyclePadX;
      cycle.forEach((id, row) => {
        autoPositions.set(id, {
          x: cycleColX,
          y: this.o.padY + row * this.o.rowHeight,
          cycle: true,
        });
      });

      this.positions.clear();
      for (const [id, pos] of autoPositions) {
        const node = this.state.graph.getNode(id);
        const manual = node && node.meta && node.meta.pos;
        if (manual && Number.isFinite(manual.x) && Number.isFinite(manual.y)) {
          this.positions.set(id, {
            x: manual.x,
            y: manual.y,
            cycle: !!pos.cycle,
            manual: true,
          });
        } else {
          this.positions.set(id, pos);
        }
      }

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
      this.contentBounds = {
        width: maxX + this.o.padX,
        height: maxY + 40,
      };
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

      this.scene = svgEl('g', {
        class: 'scene',
        transform: `translate(${this.camera.x},${this.camera.y}) scale(${this.camera.scale})`,
      });
      this.edgeLayer = svgEl('g', { class: 'edges' });
      this.nodeLayer = svgEl('g', { class: 'nodes' });
      this.overlayLayer = svgEl('g', { class: 'overlay' });
      this.scene.appendChild(this.edgeLayer);
      this.scene.appendChild(this.nodeLayer);
      this.scene.appendChild(this.overlayLayer);
      this.svg.appendChild(this.scene);

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
        this.edgeLayer.appendChild(path);

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
          this.edgeLayer.appendChild(btn);
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

        g.addEventListener('pointerdown', (e) => {
          if (e.target === port) return;
          this._startNodeDrag(id, e);
        });

        g.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.nodeDrag && this.nodeDrag.id === id && this.nodeDrag.moved) return;
          this._selectNode(id);
        });
        this.nodeLayer.appendChild(g);
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
      this.overlayLayer.appendChild(line);
      this.drag = { from: fromId, pointerId: evt.pointerId, tmpLine: line, x1, y1 };
    }

    _startNodeDrag(id, evt) {
      const p = this.positions.get(id);
      if (!p) return;
      const world = this._clientToWorld(evt);
      this.svg.setPointerCapture(evt.pointerId);
      this.nodeDrag = {
        id,
        pointerId: evt.pointerId,
        dx: world.x - p.x,
        dy: world.y - p.y,
        moved: false,
      };
      evt.preventDefault();
      evt.stopPropagation();
    }

    _onPointerMove(evt) {
      if (this.drag && evt.pointerId === this.drag.pointerId) {
        const pt = this._clientToWorld(evt);
        const { x1, y1 } = this.drag;
        const mx = (x1 + pt.x) / 2;
        this.drag.tmpLine.setAttribute(
          'd',
          `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${pt.y}, ${pt.x} ${pt.y}`
        );
        return;
      }

      if (this.nodeDrag && evt.pointerId === this.nodeDrag.pointerId) {
        const pt = this._clientToWorld(evt);
        const p = this.positions.get(this.nodeDrag.id);
        if (!p) return;
        const nx = pt.x - this.nodeDrag.dx;
        const ny = pt.y - this.nodeDrag.dy;
        const moved = Math.abs(nx - p.x) > 1 || Math.abs(ny - p.y) > 1;
        if (moved) this.nodeDrag.moved = true;
        p.x = nx;
        p.y = ny;
        this._setManualPos(this.nodeDrag.id, nx, ny);
        this._draw();
        return;
      }

      if (this.panDrag && evt.pointerId === this.panDrag.pointerId) {
        const now = this._clientToSvg(evt);
        this.camera.x += now.x - this.panDrag.x;
        this.camera.y += now.y - this.panDrag.y;
        this.panDrag.x = now.x;
        this.panDrag.y = now.y;
        this._draw();
      }
    }

    _onPointerUp(evt) {
      if (this.drag && evt.pointerId === this.drag.pointerId) {
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
            path.map((id) => this._labelOf(id)).join(' -> ')
          );
        } else if (res.success) {
          const n = res.affected ? res.affected.size : 0;
          this.onToast(
            `Edge added. Re-layered ${n} concept${n === 1 ? '' : 's'} (partial BFS).`
          );
        }
        this.onMutate();
        return;
      }

      if (this.nodeDrag && evt.pointerId === this.nodeDrag.pointerId) {
        try { this.svg.releasePointerCapture(evt.pointerId); } catch (_) {}
        const id = this.nodeDrag.id;
        const moved = this.nodeDrag.moved;
        this.nodeDrag = null;
        if (moved) {
          this.onMutate();
        } else {
          this._selectNode(id);
        }
        return;
      }

      if (this.panDrag && evt.pointerId === this.panDrag.pointerId) {
        this.panDrag = null;
      }
    }

    _nodeAt(evt) {
      const pt = this._clientToWorld(evt);
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

    _clientToWorld(evt) {
      const p = this._clientToSvg(evt);
      return {
        x: (p.x - this.camera.x) / this.camera.scale,
        y: (p.y - this.camera.y) / this.camera.scale,
      };
    }

    _setManualPos(id, x, y) {
      const n = this.state.graph.getNode(id);
      if (!n) return;
      n.meta = n.meta || {};
      n.meta.pos = { x, y };
    }

    autoLayout() {
      for (const id of this.state.graph.nodes()) {
        const n = this.state.graph.getNode(id);
        if (!n || !n.meta || !n.meta.pos) continue;
        delete n.meta.pos;
      }
      this.onMutate();
    }

    resetView() {
      this.camera = { x: 0, y: 0, scale: 1 };
      this._draw();
    }

    /* ------------------------------ events ------------------------------- */

    _bind() {
      this.svg.addEventListener('pointermove', (e) => this._onPointerMove(e));
      this.svg.addEventListener('pointerup', (e) => this._onPointerUp(e));
      this.svg.addEventListener('pointercancel', (e) => this._onPointerUp(e));

      this.svg.addEventListener('pointerdown', (e) => {
        if (e.target !== this.svg) return;
        const p = this._clientToSvg(e);
        this.panDrag = { pointerId: e.pointerId, x: p.x, y: p.y };
      });

      this.svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const pt = this._clientToSvg(e);
        const worldX = (pt.x - this.camera.x) / this.camera.scale;
        const worldY = (pt.y - this.camera.y) / this.camera.scale;
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const next = Math.max(0.35, Math.min(2.5, this.camera.scale * factor));
        this.camera.scale = next;
        this.camera.x = pt.x - worldX * next;
        this.camera.y = pt.y - worldY * next;
        this._draw();
      }, { passive: false });

      this.svg.addEventListener('click', (e) => {
        // Only a direct click on empty canvas clears selection.
        if (e.target !== this.svg) return;
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
