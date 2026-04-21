/**
 * Extractor.js  (commit 3)
 * -----------------------------------------------------------------------------
 * Offline concept + prerequisite-edge extractor. Runs entirely on the user's
 * machine; no NLP library, no network. The goal is to turn a dump of course
 * notes / study docs into a *suggestion list* the user can review before
 * anything lands on the graph.
 *
 * Strategy
 *   1. Strip fenced code blocks and inline HTML — they pollute extraction.
 *   2. Harvest concept candidates from three trusted places:
 *        (a) Markdown headings   # …, ##…, ###…
 *        (b) Items directly listed after a "prerequisites / requires /
 *            depends on" cue (either inline or as bullets).
 *        (c) Wiki-style [[double-bracket]] concept links.
 *   3. Harvest edges from two sources:
 *        (a) "X requires Y", "X depends on Y", "X builds on Y", …
 *            — a verb pattern matched only between recognised concept names.
 *        (b) "Prerequisites:" bullet groups — each bullet becomes a prereq
 *            of the most recent heading.
 *   4. Dedupe, drop self-loops, and return annotated tuples so the UI can
 *      explain *why* each suggestion was made.
 *
 * The extractor is deliberately conservative: it never auto-applies anything.
 * All suggestions flow through a preview step where the user ticks the ones
 * they want.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const VERB_GROUP =
    '(requires?|depends?\\s+on|builds?\\s+on|extends?|is\\s+based\\s+on|follows?\\s+from|uses)';
  const CUE_RX =
    /^\s*(prereq(?:uisite)?s?|requires?|depends?\s+on|before\s+studying)\s*[:\-]\s*(.*)$/i;
  const HEADING_RX = /^(#{1,6})\s+(.+?)\s*$/;
  const BULLET_RX = /^\s*[-*+]\s+(.+?)\s*$/;
  const WIKILINK_RX = /\[\[([^\]]+?)\]\]/g;
  const CAP_PHRASE_RX =
    /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){1,5})\b/g;

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function stripNoise(text) {
    // Remove fenced code blocks and inline HTML tags.
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]+`/g, '')
      .replace(/<[^>]+>/g, '');
  }

  function cleanLabel(s) {
    return String(s || '')
      .replace(/[.`*_]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitList(s) {
    return String(s || '')
      .split(/,|;|\band\b|\|/i)
      .map(cleanLabel)
      .filter(Boolean);
  }

  /**
   * @param {string} rawText
   * @param {Iterable<string>} [knownConcepts] existing labels already in the
   *        graph; used as extra anchors for verb-pattern matching.
   * @returns {{
   *   concepts: Array<{label: string, source: string}>,
   *   edges: Array<{from: string, to: string, source: string}>
   * }}
   */
  function extract(rawText, knownConcepts) {
    const text = stripNoise(rawText);
    const lines = text.split('\n');

    const conceptSet = new Map(); // label -> source
    const edgeKeys = new Set();
    const edges = [];

    const addConcept = (label, source) => {
      const c = cleanLabel(label);
      if (!c) return;
      if (!conceptSet.has(c)) conceptSet.set(c, source);
    };
    const addEdge = (from, to, source) => {
      const a = cleanLabel(from), b = cleanLabel(to);
      if (!a || !b || a === b) return;
      const k = a + '→' + b;
      if (edgeKeys.has(k)) return;
      edgeKeys.add(k);
      edges.push({ from: a, to: b, source });
    };

    // Pass A: headings, cue sections, wiki links, bullets
    let currentHeading = null;
    let cueContext = null; // { heading: string | null }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const h = HEADING_RX.exec(line);
      if (h) {
        currentHeading = cleanLabel(h[2]);
        addConcept(currentHeading, 'heading');
        cueContext = null;
        continue;
      }

      // Wiki-style links always count, regardless of context.
      let wl;
      while ((wl = WIKILINK_RX.exec(line))) addConcept(wl[1], 'wiki-link');

      // Cue line: "Prerequisites: a, b, c" or "Requires:" followed by bullets
      const cue = CUE_RX.exec(line.trim());
      if (cue) {
        const rest = cue[2] || '';
        if (rest.trim()) {
          for (const p of splitList(rest)) {
            addConcept(p, 'cue-inline');
            if (currentHeading) addEdge(p, currentHeading, 'cue-inline');
          }
          cueContext = null;
        } else {
          cueContext = { heading: currentHeading };
        }
        continue;
      }

      if (cueContext) {
        const b = BULLET_RX.exec(line);
        if (b) {
          const p = cleanLabel(b[1]);
          if (p) {
            addConcept(p, 'cue-bullet');
            if (cueContext.heading) addEdge(p, cueContext.heading, 'cue-bullet');
          }
          continue;
        }
        if (line.trim() === '') continue; // allow blank within a cue list
        cueContext = null; // any other non-empty, non-bullet ends the cue
      }
    }

    // Pass B: verb-pattern matches on the full text using all known concepts.
    const known = new Set([
      ...conceptSet.keys(),
      ...(knownConcepts || []),
    ]);
    const flat = [...known].filter(Boolean).sort((a, b) => b.length - a.length);
    if (flat.length >= 2) {
      const alt = flat.map(escRe).join('|');
      const rx = new RegExp(
        `\\b(${alt})\\b\\s+${VERB_GROUP}\\s+\\b(${alt})\\b`,
        'gi'
      );
      const flatText = text.replace(/\s+/g, ' ');
      let m;
      while ((m = rx.exec(flatText))) {
        // "X requires Y" means Y is a prereq of X  →  edge Y -> X
        const subject = m[1], object = m[3], verb = m[2];
        addConcept(subject, 'verb-subject');
        addConcept(object, 'verb-object');
        addEdge(object, subject, 'verb:' + verb.toLowerCase().replace(/\s+/g, ' '));
      }

      // "X is the prerequisite for Y" / "X is required for Y"  →  X -> Y
      const rx2 = new RegExp(
        `\\b(${alt})\\b\\s+is\\s+(?:a\\s+|the\\s+)?(?:prerequisite|required)\\s+for\\s+\\b(${alt})\\b`,
        'gi'
      );
      while ((m = rx2.exec(flatText))) {
        addEdge(m[1], m[2], 'verb:is-prereq-for');
      }
    }

    // Optional, lower-confidence: proper-case multi-word phrases that show
    // up >= 2 times. We surface them as concept candidates *only* — never
    // invent edges from them.
    const counts = new Map();
    let mm;
    while ((mm = CAP_PHRASE_RX.exec(text))) {
      const p = cleanLabel(mm[1]);
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    for (const [p, n] of counts) {
      if (n >= 2) addConcept(p, 'frequent-capitalised');
    }

    // Convert to arrays sorted for stable UI
    const concepts = [...conceptSet.entries()]
      .map(([label, source]) => ({ label, source }))
      .sort((a, b) => a.label.localeCompare(b.label));
    edges.sort((a, b) =>
      a.to.localeCompare(b.to) || a.from.localeCompare(b.from)
    );
    return { concepts, edges };
  }

  global.ChainForge = global.ChainForge || {};
  global.ChainForge.Extractor = { extract };
})(typeof window !== 'undefined' ? window : globalThis);
