/**
 * Graph.js
 * -----------------------------------------------------------------------------
 * Directed graph stored as an adjacency list. Designed for Kahn's algorithm:
 *   - O(1) amortised addNode / addEdge
 *   - O(1) indegree lookup (cached)
 *   - O(deg(u)) neighbour iteration
 *   - O(V + E) full traversal
 *
 * Nodes are opaque string ids. A `label` and free-form `meta` can be attached
 * for UI purposes without affecting the algorithm.
 *
 * This class is intentionally minimal in this initial commit. It exposes only
 * what Kahn's algorithm needs; mutation helpers for incremental re-layering
 * arrive in a later commit.
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
      // id -> number    (cached indegree, kept in sync with addEdge)
      this._indeg = new Map();
    }

    /* ------------------------------- nodes ------------------------------- */

    /**
     * Add a node. Returns true if newly inserted, false if it already existed.
     * Re-adding a node with the same id is a no-op (label/meta preserved).
     * Time: O(1) amortised.
     */
    addNode(id, label = null, meta = null) {
      if (this._nodes.has(id)) return false;
      this._nodes.set(id, {
        label: label == null ? id : label,
        meta: meta == null ? {} : meta,
      });
      this._adj.set(id, new Set());
      this._indeg.set(id, 0);
      return true;
    }

    hasNode(id) {
      return this._nodes.has(id);
    }

    getNode(id) {
      return this._nodes.get(id) || null;
    }

    /** Iterable view of all node ids. */
    nodes() {
      return this._nodes.keys();
    }

    /** Number of nodes. O(1). */
    size() {
      return this._nodes.size;
    }

    /* ------------------------------- edges ------------------------------- */

    /**
     * Add a directed edge u -> v. Auto-creates endpoints if they don't exist.
     * Parallel edges are ignored (treated as a set, not a multiset) so that
     * indegree correctly reflects distinct prerequisites.
     * Returns true if the edge is newly inserted.
     * Time: O(1) amortised.
     */
    addEdge(u, v) {
      if (u === v) {
        // self-loop is an immediate cycle; we still accept it so Kahn's
        // algorithm can surface it as a contradiction.
      }
      if (!this._nodes.has(u)) this.addNode(u);
      if (!this._nodes.has(v)) this.addNode(v);

      const out = this._adj.get(u);
      if (out.has(v)) return false;
      out.add(v);
      this._indeg.set(v, this._indeg.get(v) + 1);
      return true;
    }

    /** All outgoing neighbours of u. Returns an iterable; empty if unknown. */
    neighbors(u) {
      return this._adj.get(u) || new Set();
    }

    /** Cached indegree of v. O(1). */
    indegree(v) {
      return this._indeg.get(v) || 0;
    }

    /** Total edge count. O(V). */
    edgeCount() {
      let e = 0;
      for (const out of this._adj.values()) e += out.size;
      return e;
    }

    /** Iterate all (u, v) edges. */
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
        // "to take a you must first take b" means edge b -> a
        g.addEdge(String(b), String(a));
      }
      return g;
    }
  }

  // Expose as a global under a namespace for classic <script> offline loading.
  global.ChainForge = global.ChainForge || {};
  global.ChainForge.Graph = Graph;
})(typeof window !== 'undefined' ? window : globalThis);
