/* Sefaria shape + schema navigation, independent of the page UI. */
(function (scope) {
  'use strict';
  const integerTypes = new Set(['Integer', 'Perek', 'Pasuk', 'Mishnah', 'Halakhah', 'Siman', 'Seif', 'SeifKatan', 'Volume']);
  const hasText = value => Array.isArray(value) ? value.some(hasText) : Number.isSafeInteger(value) && value > 0;
  const title = n => n.titles?.find(t => t.lang === 'en' && t.primary)?.text || n.sharedTitle || n.key;
  function schemaLeaves(index) {
    const leaves = new Map();
    function walk(n, ref) {
      if (Array.isArray(n.nodes)) n.nodes.forEach(child => walk(child, child.default ? ref : ref + ', ' + title(child)));
      else leaves.set(ref, n);
    }
    if (index?.schema) walk(index.schema, index.title);
    return leaves;
  }
  function children(parent) {
    const type = parent.types?.[0];
    if (type !== 'Talmud' && !integerTypes.has(type)) return [];
    const counts = parent.counts;
    const values = Array.isArray(counts) ? counts : Number.isSafeInteger(counts) && counts > 0 && counts <= 10000 ? Array(counts).fill(null) : [];
    return values.flatMap((value, i) => {
      if (Array.isArray(counts) && !hasText(value)) return [];
      const address = type === 'Talmud' ? `${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}` : String(i + 1);
      const ref = parent.ref + (parent.numbered ? ':' : ' ') + address;
      return [{ref, en:address, he:address, counts:value, types:parent.types.slice(1), numbered:true}];
    });
  }
  function sections(shape, index) {
    if (!shape || shape.error) throw Error('Invalid Sefaria structure');
    const leaves = schemaLeaves(index);
    const result = [];
    function walk(entry) {
      if (Array.isArray(entry)) { entry.forEach(walk); return; }
      if (!entry || typeof entry !== 'object') return;
      const ch = entry.chapters;
      if (Array.isArray(ch) && ch.some(v => v && !Array.isArray(v) && typeof v === 'object')) { ch.forEach(walk); return; }
      if (typeof entry.title !== 'string' || !hasText(ch)) return;
      const schema = leaves.get(entry.title);
      // Offsets and uncommon address systems require Sefaria's own resolver.
      // Keep their named node selectable, without guessing numbered locations.
      const types = schema && !schema.startingAddress && !schema.index_offsets_by_depth ? schema.addressTypes || [] : [];
      const parent = {ref:entry.title, en:entry.title, he:entry.heTitle || entry.title, counts:ch, types, numbered:false};
      const parts = Array.isArray(ch) ? children(parent) : [];
      if (parts.length) parts.forEach(part => result.push({...part, en:entry.title + ' ' + part.en, he:(entry.heTitle || entry.title) + ' ' + part.he}));
      else result.push(parent);
    }
    walk(shape);
    if (!result.length) throw Error('No selectable Sefaria sections');
    return result;
  }
  const api = {sections, children};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.SefariaNavigation = api;
})(globalThis);

