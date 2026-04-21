/**
 * Graph.js
 * -----------------------------------------------------------------------------
 * Directed graph stored as twin adjacency lists (forward + reverse).
 *
 *   - O(1) amortised addNode / addEdge / removeEdge
 *   - O(1) indegree lookup (cached)
 *   - O(deg(u)) neighbour iteration
 *   - O(deg(v)) predecessor iteration (used by incremental re-layering)
 *   - O(V + E) full traversal
 *
 * Nodes are opaque string ids. A `label` and free-form `meta` can be attached
 * for UI purposes without affecting the algorithm.
 *
 * History
 *   commit 1 — addNode / addEdge / neighbors / indegree (Kahn's needs only this)
 *   commit 2 — predecessors / hasEdge / removeEdge / removeNode
 *              for incremental re-layering and interactive editing
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  class Graph {
    constructor() {
      // id -> { label, meta }
      this._nodes = new Map();
      // id -> Set<id>   (outgoing neighbours)
      this._adj = new Map();
      // id -> Set<id>   (incoming neighbours, i.e., predecessors)
      this._pred = new Map();
      // id -> number    (cached indegree, kept in sync with addEdge/removeEdge)
      this._indeg = new Map();
    }

    /* ------------------------------- nodes ------------------------------- */

    addNode(id, label = null, meta = null) {
      if (this._nodes.has(id)) return false;
      this._nodes.set(id, {
        label: label == null ? id : label,
        meta: meta == null ? {} : meta,
      });
      this._adj.set(id, new Set());
      this._pred.set(id, new Set());
      this._indeg.set(id, 0);
      return true;
    }

    hasNode(id) {
      return this._nodes.has(id);
    }

    getNode(id) {
      return this._nodes.get(id) || null;
    }

    /** Rename / reassign a node's display label. O(1). */
    setLabel(id, label) {
      const n = this._nodes.get(id);
      if (!n) return false;
      n.label = label;
      return true;
    }

    nodes() {
      return this._nodes.keys();
    }

    size() {
      return this._nodes.size;
    }

    /**
     * Remove a node and every edge touching it. O(deg(in) + deg(out)).
     */
    removeNode(id) {
      if (!this._nodes.has(id)) return false;
      // Remove outgoing edges: u=id -> each neighbour v
      for (const v of this._adj.get(id)) {
        this._pred.get(v).delete(id);
        this._indeg.set(v, this._indeg.get(v) - 1);
      }
      // Remove incoming edges: each pred p -> id
      for (const p of this._pred.get(id)) {
        this._adj.get(p).delete(id);
      }
      this._nodes.delete(id);
      this._adj.delete(id);
      this._pred.delete(id);
      this._indeg.delete(id);
      return true;
    }

    /* ------------------------------- edges ------------------------------- */

    addEdge(u, v) {
      if (!this._nodes.has(u)) this.addNode(u);
      if (!this._nodes.has(v)) this.addNode(v);

      const out = this._adj.get(u);
      if (out.has(v)) return false;
      out.add(v);
      this._pred.get(v).add(u);
      this._indeg.set(v, this._indeg.get(v) + 1);
      return true;
    }

    hasEdge(u, v) {
      const out = this._adj.get(u);
      return out ? out.has(v) : false;
    }

    /** Remove a single directed edge u -> v. O(1). */
    removeEdge(u, v) {
      const out = this._adj.get(u);
      if (!out || !out.has(v)) return false;
      out.delete(v);
      this._pred.get(v).delete(u);
      this._indeg.set(v, this._indeg.get(v) - 1);
      return true;
    }

    neighbors(u) {
      return this._adj.get(u) || new Set();
    }

    /** Incoming neighbours (= direct prerequisites) of v. O(1). */
    predecessors(v) {
      return this._pred.get(v) || new Set();
    }

    indegree(v) {
      return this._indeg.get(v) || 0;
    }

    edgeCount() {
      let e = 0;
      for (const out of this._adj.values()) e += out.size;
      return e;
    }

    *edges() {
      for (const [u, outs] of this._adj) {
        for (const v of outs) yield [u, v];
      }
    }

    /* ------------------------------- utils ------------------------------- */

    /** Build from a LC-210-style [[a, b], ...] prerequisite list where b -> a. */
    static fromLeetCode210(numCourses, prerequisites) {
      const g = new Graph();
      for (let i = 0; i < numCourses; i++) g.addNode(String(i));
      for (const [a, b] of prerequisites) {
        g.addEdge(String(b), String(a));
      }
      return g;
    }

    /** Serialize to a plain JSON-safe object. Used by Storage. */
    toJSON() {
      const nodes = [];
      for (const [id, n] of this._nodes) {
        nodes.push({ id, label: n.label, meta: n.meta });
      }
      const edges = [];
      for (const [u, outs] of this._adj) {
        for (const v of outs) edges.push([u, v]);
      }
      return { v: 1, nodes, edges };
    }

    /** Rehydrate from toJSON() output. */
    static fromJSON(data) {
      const g = new Graph();
      if (!data || !Array.isArray(data.nodes)) return g;
      for (const n of data.nodes) g.addNode(n.id, n.label, n.meta);
      if (Array.isArray(data.edges)) {
        for (const [u, v] of data.edges) g.addEdge(u, v);
      }
      return g;
    }
  }

  global.ChainForge = global.ChainForge || {};
  global.ChainForge.Graph = Graph;
})(typeof window !== 'undefined' ? window : globalThis);
