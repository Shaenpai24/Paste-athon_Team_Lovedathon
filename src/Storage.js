/**
 * Storage.js  (commit 2)
 * -----------------------------------------------------------------------------
 * Persists the graph to the browser's localStorage so your concept map
 * survives page reloads and full browser restarts. Still fully offline —
 * nothing leaves the machine.
 *
 * The storage driver is injectable so this module can be unit-tested with
 * a plain in-memory Map from Node.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const { Graph } = global.ChainForge;

  const KEY = 'chainforge:graph:v1';

  function memoryDriver() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
    };
  }

  class Storage {
    constructor(driver) {
      this.driver =
        driver ||
        (typeof localStorage !== 'undefined' ? localStorage : memoryDriver());
    }

    save(graph) {
      try {
        this.driver.setItem(KEY, JSON.stringify(graph.toJSON()));
        return true;
      } catch (_) {
        return false;
      }
    }

    /** Returns a hydrated Graph, or null if nothing stored / corrupt. */
    load() {
      try {
        const raw = this.driver.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Graph.fromJSON(parsed);
      } catch (_) {
        return null;
      }
    }

    clear() {
      try { this.driver.removeItem(KEY); return true; } catch (_) { return false; }
    }
  }

  global.ChainForge.Storage = Storage;
  global.ChainForge._memoryDriver = memoryDriver; // exposed for tests
})(typeof window !== 'undefined' ? window : globalThis);
