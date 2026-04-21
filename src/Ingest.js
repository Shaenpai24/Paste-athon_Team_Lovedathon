/**
 * Ingest.js
 * -----------------------------------------------------------------------------
 * Lightweight offline document ingestion for txt/markdown notes.
 *
 * Goal:
 *   Convert raw note text into a set of concept nodes + dependency edges that
 *   can be merged into the ChainForge graph. Parsing is heuristic by design.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  function toId(label) {
    return String(label || '')
      .trim()
      .replace(/[`*_~#>\[\]()]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function cleanLabel(raw) {
    return String(raw || '')
      .replace(/[`*_~]/g, '')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitAround(line, idx, len) {
    return [line.slice(0, idx).trim(), line.slice(idx + len).trim()];
  }

  function parseRelation(line) {
    const arrow = line.match(/(.+?)\s*(?:->|=>|→)\s*(.+)/);
    if (arrow) {
      return { prereq: arrow[1], target: arrow[2] };
    }

    const lower = line.toLowerCase();
    const markers = [
      { token: ' before ', dir: 'forward' },
      { token: ' prior to ', dir: 'forward' },
      { token: ' requires ', dir: 'reverse' },
      { token: ' depends on ', dir: 'reverse' },
      { token: ' prerequisite for ', dir: 'reverse' },
      { token: ' needed for ', dir: 'reverse' },
    ];

    for (const m of markers) {
      const idx = lower.indexOf(m.token);
      if (idx === -1) continue;
      const [a, b] = splitAround(line, idx, m.token.length);
      if (!a || !b) return null;
      if (m.dir === 'forward') return { prereq: a, target: b };
      return { prereq: b, target: a };
    }

    return null;
  }

  function likelyConceptLine(line) {
    if (!line) return false;
    if (line.length < 3 || line.length > 72) return false;
    if (/^[\d\W_]+$/.test(line)) return false;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length > 10) return false;
    return true;
  }

  function parseQuickNote(line) {
    const m = line.match(/^(?:quick\s*note|note)\s+(.+?)\s*:\s*(.+)$/i);
    if (!m) return null;
    return { concept: m[1].trim(), note: m[2].trim() };
  }

  function extractFromText(text) {
    const lines = String(text || '')
      .replace(/\r\n/g, '\n')
      .split('\n');

    const concepts = new Map(); // id -> label
    const notes = new Map(); // id -> note text
    const edges = new Set(); // "u|v"
    let ignoredRelations = 0;

    function addConcept(label) {
      const clean = cleanLabel(label);
      if (!clean) return null;
      const id = toId(clean);
      if (!id || id.length < 2) return null;
      if (!concepts.has(id)) concepts.set(id, clean);
      return id;
    }

    function addNote(id, text) {
      if (!id || !text) return;
      if (!notes.has(id)) {
        notes.set(id, text);
        return;
      }
      const prev = notes.get(id);
      if (prev.indexOf(text) === -1) notes.set(id, prev + '\n- ' + text);
    }

    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      let normalized = line
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim();

      const heading = normalized.match(/^#{1,6}\s+(.+)/);
      if (heading) {
        addConcept(heading[1]);
        continue;
      }

      const qn = parseQuickNote(normalized);
      if (qn) {
        const id = addConcept(qn.concept);
        if (id) addNote(id, qn.note);
        continue;
      }

      const rel = parseRelation(normalized);
      if (rel) {
        const u = addConcept(rel.prereq);
        const v = addConcept(rel.target);
        if (u && v && u !== v) edges.add(u + '|' + v);
        else ignoredRelations++;
        continue;
      }

      if (likelyConceptLine(normalized)) addConcept(normalized);
    }

    return {
      concepts: [...concepts.entries()].map(([id, label]) => ({
        id,
        label,
        note: notes.get(id) || '',
      })),
      edges: [...edges].map((k) => {
        const [u, v] = k.split('|');
        return [u, v];
      }),
      ignoredRelations,
    };
  }

  global.ChainForge = global.ChainForge || {};
  global.ChainForge.extractFromText = extractFromText;
})(typeof window !== 'undefined' ? window : globalThis);
