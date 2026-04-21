/**
 * Resolver.js  (commit 3)
 * -----------------------------------------------------------------------------
 * Helpers for the contradiction resolver. Given a State whose DAG carries a
 * cycle, `findCyclePath` walks the leftover indegree>0 nodes to recover a
 * concrete cycle (a -> b -> … -> a). The UI then lets the user drop any edge
 * on that cycle to restore consistency.
 *
 * Complexity
 *   findCyclePath   O(V' + E')  over the subgraph induced by the cycle set
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /**
   * @param {Graph} graph
   * @param {string[]} cycleNodes nodes with indegree > 0 after Kahn (i.e. the
   *                              set that participates in or is blocked by a
   *                              cycle)
   * @returns {string[]|null}     [a, b, …, a] forming a cycle, or null
   */
  function findCyclePath(graph, cycleNodes) {
    if (!cycleNodes || !cycleNodes.length) return null;
    const inCycleSet = new Set(cycleNodes);

    // DFS from each cycle node until we find a back edge inside inCycleSet.
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const parent = new Map();
    for (const id of inCycleSet) color.set(id, WHITE);

    for (const start of inCycleSet) {
      if (color.get(start) !== WHITE) continue;
      // Iterative DFS so we don't blow the stack on long cycles.
      const stack = [{ node: start, it: graph.neighbors(start)[Symbol.iterator]() }];
      color.set(start, GRAY);
      parent.set(start, null);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const next = top.it.next();
        if (next.done) {
          color.set(top.node, BLACK);
          stack.pop();
          continue;
        }
        const v = next.value;
        if (!inCycleSet.has(v)) continue;
        if (color.get(v) === GRAY) {
          // back edge; reconstruct cycle v -> ... -> top.node -> v
          const cycle = [v];
          let cur = top.node;
          while (cur !== v && cur != null) {
            cycle.push(cur);
            cur = parent.get(cur);
          }
          cycle.push(v); // close the loop
          return cycle.reverse();
        }
        if (color.get(v) === WHITE) {
          color.set(v, GRAY);
          parent.set(v, top.node);
          stack.push({ node: v, it: graph.neighbors(v)[Symbol.iterator]() });
        }
      }
    }
    return null;
  }

  /** Convert a cycle path [a, b, c, a] into its edge list [[a,b],[b,c],[c,a]]. */
  function cyclePathEdges(path) {
    if (!path || path.length < 2) return [];
    const out = [];
    for (let i = 0; i < path.length - 1; i++) out.push([path[i], path[i + 1]]);
    return out;
  }

  global.ChainForge = global.ChainForge || {};
  global.ChainForge.Resolver = { findCyclePath, cyclePathEdges };
})(typeof window !== 'undefined' ? window : globalThis);
