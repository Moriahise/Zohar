/* Calendar changes use Israel civil time; all lessons are already approved exports. */
(() => {
  'use strict';
  function israelDate(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function weekTarget(today) {
    const date = new Date(`${today}T12:00:00Z`);
    const day = date.getUTCDay();
    // Sun–Tue retain the preceding Shabbat; Wednesday begins the next reading.
    const offset = day >= 3 && day <= 6 ? 6-day : -(day+1);
    date.setUTCDate(date.getUTCDate()+offset);
    return date.toISOString().slice(0,10);
  }
  if (typeof module !== 'undefined') module.exports = {israelDate, weekTarget};
  if (typeof document === 'undefined') return;
  const pair = (en, he, tag='span') => {
    const node = document.createElement(tag);
    for (const [lang,text] of [['en',en],['he',he]]) {
      const child = document.createElement('span');
      child.className = `l-${lang}`; child.lang = lang;
      child.dir = lang === 'he' ? 'rtl' : 'ltr'; child.textContent = text;
      node.append(child);
    }
    return node;
  };
  let calendar, catalogue;
  function refresh() {
    if (!calendar || !catalogue) return;
    const today = israelDate();
    const target = weekTarget(today);
    const week = calendar.weeks.find(w => w.target_shabbat === target);
    if (!week) return; // Preserve the complete static fallback outside the calendar range.
    const feature = document.querySelector('.feature-card');
    if (feature) {
      const available = catalogue.editions.filter(e => e.target_shabbat <= target);
      const edition = available.sort((a,b) => a.target_shabbat.localeCompare(b.target_shabbat)).at(-1);
      const wrapper = document.createElement(edition ? 'a' : 'div');
      wrapper.className = 'feature-card';
      const top = document.createElement('div'); top.className = 'feature-top';
      top.append(pair('This week’s parashah', 'פרשת השבוע'));
      const ornament = document.createElement('div'); ornament.className = 'cover-ornament';
      const name = document.createElement('span'); name.lang='he'; name.dir='rtl';
      name.textContent = week.israel.he; ornament.append(name, document.createElement('div'));
      const bottom = document.createElement('div'); bottom.className = 'cover-bottom';
      bottom.append(pair(week.israel.en, week.israel.he, 'h2'));
      if (edition) {
        wrapper.href = `./shiur/${edition.id}/`;
        const latest = edition.target_shabbat !== target;
        bottom.append(pair(latest ? 'Latest available Zohar study' : 'This week’s Zohar study',
          latest ? 'לימוד הזוהר האחרון הזמין' : 'לימוד הזוהר השבועי', 'p'));
        bottom.append(pair(edition.title.en, edition.title.he, 'h3'));
      } else {
        bottom.append(pair('The study will appear after editorial approval.', 'הלימוד יופיע לאחר אישור המערכת.', 'p'));
      }
      wrapper.append(top, ornament, bottom); feature.replaceWith(wrapper);
    }
    const list = document.querySelector('.calendar-list');
    if (list) {
      list.querySelectorAll('.calendar-row').forEach(n => n.remove());
      for (const w of calendar.weeks.filter(w => w.target_shabbat >= target).slice(0,5).reverse()) {
        const row = document.createElement('div'); row.className='calendar-row';
        row.append(pair(w.target_shabbat,w.hebrew_date),pair(w.israel.en,w.israel.he,'strong'),
          pair('Calendar preview','תצוגת לוח'));
        list.prepend(row);
      }
    }
  }
  if (document.querySelector('.calendar-list')) {
    Promise.all(['calendar','catalogue'].map(name => fetch(`./data/${name}.json`).then(r => {
      if (!r.ok) throw new Error('Calendar unavailable'); return r.json();
    }))).then(([cal,cat]) => { calendar=cal; catalogue=cat; refresh(); }).catch(() => {});
    setInterval(refresh,60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
})();
