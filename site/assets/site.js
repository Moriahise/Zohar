/* Progressive enhancement only: the complete study is present in HTML. */
(() => {
  'use strict';
  const root = document.documentElement;
  const allowed = new Set(['en', 'he', 'parallel']);
  let saved;
  try { saved = localStorage.getItem('zohar.readingMode'); } catch (_) { /* Storage is optional. */ }
  const url = new URL(location.href);
  let mode = url.searchParams.get('lang') || saved || 'en';
  if (!allowed.has(mode)) mode = 'en';
  const setMode = (next, persist = true) => {
    mode = next;
    root.dataset.mode = next;
    root.lang = next === 'he' ? 'he' : 'en';
    // Keep the navigation composition stable; each Hebrew text has explicit RTL.
    document.querySelectorAll('[data-mode-set]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.modeSet === next)));
    document.querySelectorAll('option[data-en]').forEach(option => { option.textContent = next === 'he' ? option.dataset.he : option.dataset.en; });
    if (persist) {
      try { localStorage.setItem('zohar.readingMode', next); } catch (_) { /* Private mode remains usable. */ }
      const current = new URL(location.href);
      current.searchParams.set('lang', next);
      try { history.replaceState(null, '', current); } catch (_) { /* Local file previews are supported. */ }
    }
    filter();
  };
  const normalize = value => value.normalize('NFKD').replace(/[\u0591-\u05c7]/g, '').toLowerCase();
  const cards = [...document.querySelectorAll('.edition-card')];
  const search = document.querySelector('#search');
  const category = document.querySelector('#category');
  function filter() {
    if (!search || !category) return;
    const tokens = normalize(search.value).split(/\s+/).filter(Boolean);
    let count = 0;
    cards.forEach(card => {
      const text = normalize(card.dataset.search);
      const show = (category.value === 'all' || category.value === card.dataset.category) && tokens.every(token => text.includes(token));
      card.hidden = !show;
      if (show) count++;
    });
    document.querySelector('#no-results').hidden = count !== 0;
    document.querySelector('#search-status').textContent = mode === 'he' ? `${count} שיעורים נמצאו` : `${count} ${count === 1 ? 'study' : 'studies'} found`;
  }
  document.querySelectorAll('[data-mode-set]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.modeSet)));
  document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));
  search?.addEventListener('input', filter);
  category?.addEventListener('change', filter);
  setMode(mode, false);
  root.classList.remove('no-js');
})();

