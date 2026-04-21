/**
 * Kahn.js
 * -----------------------------------------------------------------------------
 * Kahn's algorithm for topological sorting of a DAG, with BFS layering and
 * cycle detection. This is the exact algorithm LeetCode 210. Course Schedule II
 * expects: repeatedly remove zero-indegree nodes, decrement the indegree of
 * their successors, and record the removal order.
 *
 * Complexity
 *   time:  O(V + E)   — each node is enqueued and dequeued once, each edge is
 *                       relaxed once.
 *   space: O(V + E)   — adjacency + indegree + queue + result + layers.
 *
 * Why BFS, not DFS?
 *   Two reasons specific to ChainForge:
 *     1. BFS gives us a natural *layer index* for each node — "how many
 *        prerequisites deep is this concept?" — which drives the visual
 *        canvas and the mastery path in later commits.
 *     2. Indegree-driven BFS detects cycles by counting: if we processed
 *        fewer than V nodes, the leftovers lie on at least one cycle.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /**
   * Run Kahn's algorithm on the given graph.
   *
   * @param {Graph} graph
   * @param {Object} [opts]
   * @param {(a:string,b:string)=>number} [opts.tieBreak]
   *        Optional deterministic ordering within a layer. Defaults to
   *        insertion order (stable).
   *
   * @returns {
   *   success: boolean,           // true iff a full topological order exists
   *   order:   string[],          // topological ordering (length === V when success)
   *   layers:  string[][],        // BFS layers; layers[i] are nodes with longest
   *                               // prerequisite path of length i from a root
   *   layerOf: Map<string,number>,// node id -> layer index (undefined if on cycle)
   *   cycleNodes: string[],       // when !success, ids still carrying indegree > 0
   * }
   */
  function kahn(graph, opts = {}) {
    const tieBreak = opts.tieBreak || null;

    // Snapshot mutable indegree so we don't touch the graph's cached values.
    // O(V)
    const indeg = new Map();
    for (const id of graph.nodes()) {
      indeg.set(id, graph.indegree(id));
    }

    // Seed queue with every zero-indegree node (these are the "roots" of the DAG).
    // O(V)
    let currentLayer = [];
    for (const [id, d] of indeg) {
      if (d === 0) currentLayer.push(id);
    }
    if (tieBreak) currentLayer.sort(tieBreak);

    const order = [];
    const layers = [];
    const layerOf = new Map();

    // BFS layer by layer. Overall O(V + E): every node enters currentLayer
    // exactly once, and each edge (u, v) is relaxed exactly once when u is
    // processed.
    let depth = 0;
    while (currentLayer.length > 0) {
      layers.push(currentLayer.slice());
      const nextLayer = [];
      for (const u of currentLayer) {
        layerOf.set(u, depth);
        order.push(u);
        for (const v of graph.neighbors(u)) {
          const nd = indeg.get(v) - 1;
          indeg.set(v, nd);
          if (nd === 0) nextLayer.push(v);
        }
      }
      if (tieBreak) nextLayer.sort(tieBreak);
      currentLayer = nextLayer;
      depth++;
    }

    // Cycle detection: any node whose indegree never hit zero lies on a cycle
    // (or is downstream of one).
    if (order.length !== graph.size()) {
      const cycleNodes = [];
      for (const [id, d] of indeg) {
        if (d > 0) cycleNodes.push(id);
      }
      return {
        success: false,
        order,            // partial — still useful for "what we *could* sequence"
        layers,
        layerOf,
        cycleNodes,
      };
    }

    return {
      success: true,
      order,
      layers,
      layerOf,
      cycleNodes: [],
    };
  }

  /**
   * LeetCode 210 adapter: returns [] on cycle, otherwise a full order.
   * This is the exact signature LC210 grades against.
   *   findOrder(2, [[1,0]])          -> ["0","1"]  (or numeric after map)
   *   findOrder(2, [[1,0],[0,1]])    -> []
   *
   * @param {number} numCourses
   * @param {number[][]} prerequisites
   * @returns {number[]}
   */
  function findOrder(numCourses, prerequisites) {
    const g = global.ChainForge.Graph.fromLeetCode210(numCourses, prerequisites);
    const res = kahn(g);
    if (!res.success) return [];
    return res.order.map((s) => parseInt(s, 10));
  }

  global.ChainForge = global.ChainForge || {};
  global.ChainForge.kahn = kahn;
  global.ChainForge.findOrder = findOrder;
})(typeof window !== 'undefined' ? window : globalThis);
