/**
 * State.js  (commit 2)
 * -----------------------------------------------------------------------------
 * The State object owns a Graph plus a persistent `layerOf` mapping that is
 * kept in sync across incremental edits. It is what lets ChainForge avoid
 * rerunning Kahn's algorithm from scratch on every user edit — only the
 * affected subgraph is re-layered.
 *
 * Operations and their complexity
 *   recomputeAll()               — O(V + E)      full Kahn's, seeds layerOf
 *   wouldCreateCycle(u, v)       — O(V' + E')    BFS reachability from v → u
 *                                               (V', E' = subgraph reachable
 *                                                from v; never touches the
 *                                                rest of the DAG)
 *   addEdge(u, v)                — O(V'' + E'')  forward layer propagation
 *                                               from v; only visits descendants
 *                                               whose layer actually increases.
 *   removeEdge(u, v)             — O(|D| + E_D)  recompute layers on the
 *                                               descendant closure D of v
 *                                               using a local topological
 *                                               traversal.
 *   removeNode(id)               — O(|D| + E_D)  same, applied to every
 *                                               successor of id.
 *   findPath(from, to)           — O(V' + E')    BFS with parent map
 *
 * Correctness
 *   layerOf[v] is maintained as the length of the longest prerequisite path
 *   from any root to v. Equivalently, layerOf[v] = 1 + max(layerOf[p]) over
 *   predecessors p (zero if v has no predecessors). Every mutation restores
 *   this invariant on the affected subgraph.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const { Graph, kahn } = global.ChainForge;

  class State {
    constructor(graph) {
      this.graph = graph || new Graph();
      this.layerOf = new Map();    // id -> layer index
      this.cycle = null;            // null when consistent, else string[]
      this._listeners = new Set();
    }

    on(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }
    _emit(event) {
      for (const fn of this._listeners) fn(event);
    }

    /* ------------------------------- queries ------------------------------ */

    reachable(src, tgt) {
      if (!this.graph.hasNode(src)) return false;
      if (src === tgt) return true;
      const visited = new Set([src]);
      const queue = [src];
      while (queue.length) {
        const x = queue.shift();
        for (const y of this.graph.neighbors(x)) {
          if (y === tgt) return true;
          if (!visited.has(y)) {
            visited.add(y);
            queue.push(y);
          }
        }
      }
      return false;
    }

    /** Would adding edge u -> v close a cycle? */
    wouldCreateCycle(u, v) {
      if (u === v) return true;
      if (!this.graph.hasNode(v)) return false;
      return this.reachable(v, u);
    }

    /** BFS path from -> to through existing edges, or null. */
    findPath(from, to) {
      if (!this.graph.hasNode(from)) return null;
      if (from === to) return [from];
      const parent = new Map([[from, null]]);
      const queue = [from];
      while (queue.length) {
        const x = queue.shift();
        for (const y of this.graph.neighbors(x)) {
          if (parent.has(y)) continue;
          parent.set(y, x);
          if (y === to) {
            const path = [];
            let cur = y;
            while (cur != null) { path.push(cur); cur = parent.get(cur); }
            return path.reverse();
          }
          queue.push(y);
        }
      }
      return null;
    }

    /** Topological order (layer-major, then label-alphabetical within layer). */
    topoOrder() {
      const arr = [...this.layerOf.entries()];
      arr.sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];
        const la = (this.graph.getNode(a[0])?.label) || a[0];
        const lb = (this.graph.getNode(b[0])?.label) || b[0];
        return la < lb ? -1 : la > lb ? 1 : 0;
      });
      return arr.map(([id]) => id);
    }

    /* ------------------------------- mutations ---------------------------- */

    /** Full refresh using Kahn's. O(V + E). */
    recomputeAll() {
      const r = kahn(this.graph);
      this.layerOf = new Map(r.layerOf);
      this.cycle = r.success ? null : r.cycleNodes;
      // Nodes on a cycle have no valid layer; give them Infinity so UI can
      // render them separately.
      if (!r.success) {
        for (const id of r.cycleNodes) this.layerOf.set(id, Infinity);
      }
      this._emit({ type: 'recompute' });
      return r;
    }

    addNode(id, label, meta) {
      if (this.graph.hasNode(id)) return false;
      this.graph.addNode(id, label, meta);
      this.layerOf.set(id, 0);
      this._emit({ type: 'node-added', id });
      return true;
    }

    removeNode(id) {
      if (!this.graph.hasNode(id)) return { success: false };
      const successors = [...this.graph.neighbors(id)];
      this.graph.removeNode(id);
      this.layerOf.delete(id);
      const affected = new Set([id]);
      for (const s of successors) {
        for (const a of this._recomputeDescendants(s)) affected.add(a);
      }
      this._emit({ type: 'node-removed', id, affected });
      return { success: true, affected };
    }

    /**
     * Incremental edge add with cycle pre-check and forward layer propagation.
     * Visits only nodes whose layer strictly increases — the signature
     * "partial BFS re-layering" feature.
     */
    addEdge(u, v) {
      if (!this.graph.hasNode(u)) this.addNode(u);
      if (!this.graph.hasNode(v)) this.addNode(v);

      if (this.wouldCreateCycle(u, v)) {
        const path = this.findPath(v, u);
        const cyclePath = path ? [...path, v] : [u, v];
        return { success: false, reason: 'cycle', cyclePath };
      }
      const added = this.graph.addEdge(u, v);
      if (!added) {
        return { success: true, affected: new Set(), noop: true };
      }

      const affected = this._propagateForward(
        v,
        (this.layerOf.get(u) ?? 0) + 1
      );
      this._emit({ type: 'edge-added', u, v, affected });
      return { success: true, affected };
    }

    removeEdge(u, v) {
      if (!this.graph.hasEdge(u, v)) return { success: false };
      this.graph.removeEdge(u, v);
      const affected = this._recomputeDescendants(v);
      this._emit({ type: 'edge-removed', u, v, affected });
      return { success: true, affected };
    }

    /* ----------------------- partial re-layering ------------------------- */

    /**
     * Forward propagation used after an edge ADD.
     * Starts at `start`, bumping its layer to `minLayer` if necessary, then
     * walks successors. A node enters the queue only when its layer increases;
     * so unaffected descendants are never touched.
     *
     * Correctness: adding an edge can only INCREASE layers (longest-path depth
     * is monotone in edge additions), so a forward pass propagating the bump
     * is sufficient — no predecessor recomputation is needed.
     */
    _propagateForward(start, minLayer) {
      const cur = this.layerOf.get(start) ?? 0;
      if (cur >= minLayer) return new Set();
      this.layerOf.set(start, minLayer);
      const affected = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const x = queue.shift();
        const lx = this.layerOf.get(x);
        for (const y of this.graph.neighbors(x)) {
          const ly = this.layerOf.get(y) ?? 0;
          if (lx + 1 > ly) {
            this.layerOf.set(y, lx + 1);
            if (!affected.has(y)) {
              affected.add(y);
              queue.push(y);
            } else {
              queue.push(y); // may need to propagate its new value again
            }
          }
        }
      }
      return affected;
    }

    /**
     * Full layer recomputation restricted to the descendant closure of `start`.
     * Used after an edge or node REMOVAL, where layers can only DECREASE but
     * the correct new value depends on all (possibly external) predecessors.
     *
     * Step 1: collect the descendant set D of start (O(|D| + E_D)).
     * Step 2: topologically sort D using edges restricted to D.
     * Step 3: walk D in topo order, recomputing layer[x] as
     *           max(0, max over ALL preds p of (layerOf[p] + 1)).
     *         External predecessors keep their existing layer; internal
     *         predecessors have already been settled earlier in topo order.
     */
    _recomputeDescendants(start) {
      if (!this.graph.hasNode(start)) return new Set();
      // Step 1: descendant set
      const D = new Set([start]);
      const bfs = [start];
      while (bfs.length) {
        const x = bfs.shift();
        for (const y of this.graph.neighbors(x)) {
          if (!D.has(y)) { D.add(y); bfs.push(y); }
        }
      }
      // Step 2: local kahn restricted to edges inside D
      const localIndeg = new Map();
      for (const x of D) {
        let d = 0;
        for (const p of this.graph.predecessors(x)) if (D.has(p)) d++;
        localIndeg.set(x, d);
      }
      const queue = [];
      for (const [x, d] of localIndeg) if (d === 0) queue.push(x);
      const topo = [];
      while (queue.length) {
        const x = queue.shift();
        topo.push(x);
        for (const y of this.graph.neighbors(x)) {
          if (!D.has(y)) continue;
          const nd = localIndeg.get(y) - 1;
          localIndeg.set(y, nd);
          if (nd === 0) queue.push(y);
        }
      }
      // Step 3: recompute layer for each node in D using ALL predecessors
      const affected = new Set();
      for (const x of topo) {
        let newL = 0;
        for (const p of this.graph.predecessors(x)) {
          const lp = this.layerOf.get(p) ?? 0;
          if (lp + 1 > newL) newL = lp + 1;
        }
        const prev = this.layerOf.get(x);
        if (prev !== newL) {
          this.layerOf.set(x, newL);
          affected.add(x);
        }
      }
      return affected;
    }
  }

  global.ChainForge.State = State;
})(typeof window !== 'undefined' ? window : globalThis);
