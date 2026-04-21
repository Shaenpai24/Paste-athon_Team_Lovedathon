/**
 * Exporter.js  (commit 3)
 * -----------------------------------------------------------------------------
 * Serialises the current State into a human-readable Markdown study plan:
 * a sequenced "Study order" list plus a "Layer breakdown" showing which
 * concepts can be studied in parallel. When the DAG carries a cycle the
 * export flags it as a contradiction section.
 *
 * A companion `download(filename, content)` helper spits the string out to
 * the user's Downloads folder using a Blob URL — still fully offline.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  function toMarkdown(state, opts = {}) {
    const title = opts.title || 'ChainForge Mastery Path';
    const graph = state.graph;
    const layerOf = state.layerOf;

    const finite = [...layerOf.entries()].filter(([, l]) => Number.isFinite(l));
    const cycleIds = [...layerOf.entries()]
      .filter(([, l]) => !Number.isFinite(l))
      .map(([id]) => id);

    const labelOf = (id) => (graph.getNode(id)?.label) || id;

    // Sort finite nodes by (layer, label)
    finite.sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return labelOf(a[0]).localeCompare(labelOf(b[0]));
    });
    const maxLayer = finite.length ? finite[finite.length - 1][1] : -1;

    const lines = [];
    lines.push('# ' + title);
    lines.push('');
    const status = cycleIds.length
      ? `**${graph.size()} concepts** · **${graph.edgeCount()} prerequisites** · ⚠ contradiction detected`
      : `**${graph.size()} concepts** across **${maxLayer + 1}** BFS layers · consistent DAG`;
    lines.push(status);
    lines.push('');

    if (finite.length) {
      lines.push('## Study order');
      lines.push('');
      let i = 1;
      for (const [id, layer] of finite) {
        lines.push(`${i}. \`L${layer}\` ${labelOf(id)}`);
        i++;
      }
      lines.push('');
      lines.push('## Layer breakdown');
      lines.push('');
      for (let L = 0; L <= maxLayer; L++) {
        const inLayer = finite.filter(([, l]) => l === L).map(([id]) => id);
        if (!inLayer.length) continue;
        const parallelNote = inLayer.length > 1 ? ' — study in parallel' : '';
        lines.push(`### Layer ${L}${parallelNote}`);
        lines.push('');
        for (const id of inLayer) {
          const preds = [...graph.predecessors(id)].map(labelOf);
          const predLabel = preds.length
            ? ` _(after: ${preds.join(', ')})_`
            : ' _(no prerequisites)_';
          lines.push(`- **${labelOf(id)}**${predLabel}`);
        }
        lines.push('');
      }
    } else if (!cycleIds.length) {
      lines.push('_(Graph is empty.)_');
      lines.push('');
    }

    if (cycleIds.length) {
      lines.push('## Contradiction');
      lines.push('');
      lines.push(
        'The following concepts form at least one cycle and cannot be ' +
        'placed on a linear study path until an edge is dropped:'
      );
      lines.push('');
      for (const id of cycleIds.sort((a, b) => labelOf(a).localeCompare(labelOf(b)))) {
        lines.push(`- ${labelOf(id)}`);
      }
      lines.push('');
    }

    const footer =
      opts.footer ||
      '_Generated offline by ChainForge. Topological order via Kahn\'s algorithm (O(V + E))._';
    lines.push(footer);
    lines.push('');
    return lines.join('\n');
  }

  function download(filename, content, mime) {
    if (typeof document === 'undefined') return false;
    const blob = new Blob([content], { type: mime || 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'chainforge.md';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
    return true;
  }

  global.ChainForge = global.ChainForge || {};
  global.ChainForge.Exporter = { toMarkdown, download };
})(typeof window !== 'undefined' ? window : globalThis);
