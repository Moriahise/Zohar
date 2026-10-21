/* Read-only library connections. Remote markup is never inserted as HTML. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('source-search')) return;
  const root = document.documentElement;
  const mode = () => root.dataset.mode === 'he' ? 'he' : 'en';
  const text = (en, he) => mode() === 'he' ? he : en;
  const normal = value => String(value || '').normalize('NFKC').replace(/[\u0591-\u05bd\u05bf-\u05c7]/g, '').toLowerCase().replace(/[׳’]/g, "'").replace(/״/g, '"');
  const tokens = value => normal(value).match(/[\p{L}\p{N}]+(?:['"][\p{L}\p{N}]+)*/gu) || [];
  const allowed = url => {
    const u = new URL(url, location.href);
    const permitted = u.origin === location.origin || (
      u.protocol === 'https:' && !u.username && !u.password &&
      ((u.hostname === 'shekhina.org') ||
       (u.hostname === 'moriahise.github.io' && u.pathname.startsWith('/Sanhedrin/')) ||
       (u.hostname === 'storage.googleapis.com' && u.pathname.startsWith('/sefaria-export/json/')) ||
       (u.hostname === 'www.sefaria.org' && ['/api/texts/', '/api/shape/', '/api/v2/raw/index/'].some(path=>u.pathname.startsWith(path)))));
    if (!permitted || decodeURIComponent(u.pathname).split('/').includes('..')) throw Error('Unapproved library URL');
    return u;
  };
  async function json(url, optional = false, limit = 8_000_000) {
    const u = allowed(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(u, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer', cache:'no-cache'});
      if (response.status === 404 && optional) return null;
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      if (response.url) allowed(response.url);
      if (Number(response.headers.get('Content-Length')) > limit) throw Error('Source exceeds size limit');
      const reader = response.body?.getReader();
      let raw;
      if (reader) {
        const chunks = []; let total = 0;
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > limit) { await reader.cancel(); throw Error('Source exceeds size limit'); }
          chunks.push(value);
        }
        const combined = new Uint8Array(total); let offset = 0;
        chunks.forEach(chunk => { combined.set(chunk, offset); offset += chunk.byteLength; });
        raw = new TextDecoder().decode(combined);
      } else {
        raw = await response.text();
        if (new TextEncoder().encode(raw).length > limit) throw Error('Source exceeds size limit');
      }
      return JSON.parse(raw);
    } finally { clearTimeout(timer); }
  }
  async function hash(value) {
    const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function node(tag, content, cls) {
    const item = document.createElement(tag);
    if (content !== undefined) item.textContent = content;
    if (cls) item.className = cls;
    return item;
  }
  function plain(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,template,noscript').forEach(n=>n.remove());
    doc.querySelectorAll('p,br,div,li').forEach(n=>n.prepend('\n'));
    return doc.body.textContent.trim();
  }
  function link(title, href) {
    const u = new URL(href);
    if (u.protocol !== 'https:' || u.username || u.password) throw Error('Unsafe source link');
    const a = node('a',title); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  let sanPromise, cataloguePromise, searchEpoch = 0, readerEpoch = 0;
  const cache = new Map();
  async function sanhedrin() {
    if (!sanPromise) sanPromise = (async () => {
      for (const base of ['https://shekhina.org/', 'https://moriahise.github.io/Sanhedrin/']) {
        try {
          const m = await json(base+'catalog/manifest.json');
          if (m.schema !== 1 || !/^releases\/v1-[a-f0-9]{24}\/$/.test(m.data_base) || !Number.isSafeInteger(m.total) || m.total <= 0 || !Number.isInteger(m.page_size) || m.page_size < 1 || m.page_size > 1000) throw Error('Invalid catalogue');
          $('sanhedrin-state').textContent = text(`${m.total.toLocaleString()} records · connected`,`${m.total.toLocaleString()} רשומות · מחובר`);
          return {base, m};
        } catch (_) { /* Try the published mirror, without altering either site. */ }
      }
      throw Error(text('Sanhedrin is temporarily unavailable.','סנהדרין אינו זמין כעת.'));
    })().catch(error=>{sanPromise=null;throw error;});
    return sanPromise;
  }
  async function sanData(relative, optional=false) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.includes('..') || relative.startsWith('/')) throw Error('Invalid catalogue path');
    const {base,m} = await sanhedrin();
    const url = base+m.data_base+relative;
    if (!cache.has(url)) {
      cache.set(url,json(url,optional).then(async value=>{
        if(value===null) {
          const current=await json(base+'catalog/manifest.json');
          if(current.release!==m.release) throw Error('Release changed');
        }
        return value;
      }).catch(error=>{cache.delete(url);sanPromise=null;throw Error(text('The selected export could not be read. Search again after reloading.','לא ניתן לקרוא את היצוא שנבחר. טענו מחדש ונסו שוב.'));}));
      if (cache.size > 50) cache.delete(cache.keys().next().value);
    }
    return cache.get(url);
  }
  async function sanSearch(query) {
    const {m} = await sanhedrin();
    let terms = [...new Set(tokens(query).map(t=>m.synonyms?.[t] || t))].filter(t=>t.length>=2 && !m.stopwords.includes(t));
    if (terms.length>8) throw Error(text('Use at most eight search terms.','השתמשו בעד שמונה מילות חיפוש.'));
    let candidates;
    if (!query.trim()) candidates=Array.from({length:m.total},(_,n)=>n);
    else if (!terms.length) candidates=[];
    else {
      const maps = await Promise.all(terms.map(async term=>{
        const part = await sanData('search/'+(await hash(term)).slice(0,3)+'.json',true);
        const list = part?.[term] || []; const map=new Map();
        if (list.length%2) throw Error('Invalid search data');
        for (let i=0;i<list.length;i+=2) {
          if (!Number.isInteger(list[i]) || list[i]<0 || list[i]>=m.total) throw Error('Invalid search data');
          map.set(list[i],list[i+1]);
        }
        return map;
      }));
      maps.sort((a,b)=>a.size-b.size);
      candidates=[...maps[0].keys()].filter(n=>maps.every(map=>map.has(n)));
      candidates.sort((a,b)=>maps.reduce((s,map)=>s+map.get(b)-map.get(a),0) || a-b);
    }
    const chosen=candidates.slice(0,12); const rows=new Map();
    const pages=[...new Set(chosen.map(n=>Math.floor(n/m.page_size)))];
    for (const p of pages) (await sanData(`catalog/pages/${String(p).padStart(5,'0')}.json`)).forEach(row=>rows.set(row.n,row));
    if (chosen.some(n=>!rows.has(n))) throw Error('Incomplete catalogue page');
    return {total:candidates.length,items:chosen.map(n=>rows.get(n))};
  }
  async function catalogue() {
    if (!cataloguePromise) cataloguePromise=json('../data/sefaria-library.json',false,10_000_000).then(c=>{
      if (c.schema!==1 || !Array.isArray(c.works)) throw Error('Invalid Sefaria catalogue');
      $('sefaria-state').textContent=text(`${c.works.length.toLocaleString()} works · catalogue ready`,`${c.works.length.toLocaleString()} חיבורים · הקטלוג מוכן`);
      return c;
    }).catch(error=>{cataloguePromise=null;throw error;});
    return cataloguePromise;
  }
  async function sefSearch(query) {
    const c=await catalogue();const terms=normal(query).split(/\s+/).filter(Boolean);
    const matches=c.works.filter(b=>terms.every(t=>normal(b.title+' '+(b.he_title||'')+' '+b.categories.join(' ')).includes(t)));
    return {total:matches.length,items:matches.slice(0,12)};
  }
  function feedback(message) { $('source-feedback').textContent=message; }
  function resultGroup(name,result,provider) {
    const section=node('section',undefined,'library-results-group');
    section.append(node('h2',name),node('p',text(`${result.total.toLocaleString()} matches · showing up to 12`,`${result.total.toLocaleString()} תוצאות · מוצגות עד 12`),'result-count'));
    if (!result.items.length) section.append(node('p',text('No results. Try another spelling or a broader term.','לא נמצאו תוצאות. נסו כתיב אחר או מונח רחב יותר.')));
    result.items.forEach(item=>{
      const card=node('article',undefined,'source-result');
      const title=provider==='sanhedrin' ? item.title : (mode()==='he' ? item.he_title||item.title : item.title);
      const button=node('button',title,'source-title');button.type='button';button.dir='auto';
      button.addEventListener('click',()=>provider==='sanhedrin'?openSanhedrin(item):openBook(item));
      card.append(button,node('p',provider==='sanhedrin'?item.excerpt:item.categories.join(' › ')));
      const meta=provider==='sanhedrin' ? `${item.provider} · ${item.answers} ${text('answers','תשובות')}` : Object.keys(item.languages).join(' / ');
      card.append(node('small',meta));section.append(card);
    });
    return section;
  }
  async function search(event) {
    event?.preventDefault();const epoch=++searchEpoch;
    const query=$('source-query').value;const provider=$('source-provider').value;
    feedback(text('Searching the connected libraries…','מחפשים בספריות המחוברות…'));
    const jobs=[];
    if (provider!=='sefaria') jobs.push({name:'Sanhedrin · סנהדרין',key:'sanhedrin',run:sanSearch(query)});
    if (provider!=='sanhedrin') jobs.push({name:'Sefaria · ספריא',key:'sefaria',run:sefSearch(query)});
    const results=await Promise.allSettled(jobs.map(j=>j.run));
    if (epoch!==searchEpoch) return;
    const fragment=document.createDocumentFragment();
    results.forEach((r,i)=>{
      if (r.status==='fulfilled') fragment.append(resultGroup(jobs[i].name,r.value,jobs[i].key));
      else fragment.append(node('p',jobs[i].name+': '+r.reason.message,'source-error'));
    });
    $('source-results').replaceChildren(fragment);
    feedback(text('Choose a result to read its source text.','בחרו תוצאה לקריאת המקור.'));
  }
  function flattenText(value,out=[]) {
    if (typeof value==='string') out.push(plain(value));
    else if (Array.isArray(value)) value.forEach(v=>flattenText(v,out));
    else if (value && typeof value==='object') Object.entries(value).forEach(([key,v])=>{out.push(key);flattenText(v,out);});
    return out.filter(Boolean);
  }
  async function showDossier(dossier,epoch,extraLinks=[]) {
    dossier.sha256=await hash(dossier.text);
    if (epoch!==readerEpoch) return;
    const reader=$('source-reader');const heading=node('h2',mode()==='he'?dossier.reference_he:dossier.reference_en);heading.dir='auto';
    const meta=node('p',`${dossier.provider} · ${dossier.version} · ${dossier.license || 'unrecorded'}`,'source-reader-meta');
    const passage=node('div',dossier.text,'source-reader-text');passage.dir=dossier.language==='he'?'rtl':'ltr';passage.lang=dossier.language;
    const actions=node('div',undefined,'source-reader-actions');actions.append(link(text('Original source ↗','המקור המקורי ↗'),dossier.url),...extraLinks);
    reader.replaceChildren(heading,meta,actions,passage);feedback(text('Source loaded.','המקור נטען.'));
  }
  async function openSanhedrin(item) {
    const epoch=++readerEpoch;feedback(text('Reading the selected Sanhedrin record…','קוראים את הרשומה שנבחרה…'));
    try {
      const digest=await hash(item.id);const locations=await sanData('catalog/locator/'+digest.slice(0,2)+'.json');
      const loc=locations[item.id];const expected='content/'+digest.slice(0,2)+'/'+digest+'.json';
      if (loc?.file!==expected) throw Error('Invalid source locator');
      const q=await sanData(expected);if(q.id!==item.id) throw Error('Source identity mismatch');
      const {base,m}=await sanhedrin();
      const parts=[plain(q.question_html)];
      q.answers.forEach(a=>parts.push(plain(a.html)));
      const dossier={id:'sanhedrin-'+digest.slice(0,20),provider:'sanhedrin',language:q.language||'he',reference_en:q.title_en||q.title,reference_he:q.title_he||'סנהדרין · '+q.id,url:base+'qa.html?id='+encodeURIComponent(q.id),original_url:q.url,version:m.release,license:q.license||'unrecorded',author:q.author,answers_attribution:q.answers.map(({html,...a})=>a),retrieved_at:new Date().toISOString(),text:parts.filter(Boolean).join('\n\n'),origin:{public_id:q.id,release:m.release,data_base:m.data_base}};
      await showDossier(dossier,epoch);
    } catch(error) {if(epoch===readerEpoch) feedback(error.message);}
  }
  async function exactReference(reference,language,epoch) {
    const data=await json('https://www.sefaria.org/api/texts/'+encodeURIComponent(reference)+'?context=0&commentary=0&pad=0');
    if (data.error || !data.ref) throw Error(data.error || 'Reference unresolved');
    const isHebrew=language==='Hebrew';const parts=flattenText(data[isHebrew?'he':'text']);
    if (!parts.length) throw Error(text('No text in the selected language.','אין טקסט בשפה שנבחרה.'));
    const version=data[isHebrew?'heVersionTitle':'versionTitle']||'unrecorded';
    return {id:'sefaria-'+(await hash(data.ref+'|'+language+'|'+version)).slice(0,20),provider:'sefaria',language:isHebrew?'he':'en',reference_en:data.ref,reference_he:data.heRef||'ספריא',url:'https://www.sefaria.org/'+encodeURIComponent(data.ref.replaceAll(' ','_')),version,version_source:data[isHebrew?'heVersionSource':'versionSource'],license:data[isHebrew?'heLicense':'license']||'unrecorded',retrieved_at:new Date().toISOString(),text:parts.join('\n'),origin:{resolved_ref:data.ref,retrieval:'exact-reference-api'}};
  }
  let works = [], selectedBook = null, sectionList = [], selectedPassage = null, pickerEpoch = 0;
  const structures = new Map();
  const categoryHebrew = {'Tanakh':'תנ״ך','Mishnah':'משנה','Talmud':'תלמוד','Midrash':'מדרש','Halakhah':'הלכה','Kabbalah':'קבלה','Liturgy':'תפילה','Jewish Thought':'מחשבת ישראל','Chasidut':'חסידות','Musar':'מוסר','Responsa':'שו״ת','Tosefta':'תוספתא','Second Temple':'בית שני','Reference':'ספרי עזר'};
  function option(value, en, he = en) {
    const o = node('option',text(en,he));o.value=value;o.dataset.en=en;o.dataset.he=he;o.dir='auto';return o;
  }
  function bilingual(element, en, he) {
    const english=node('span',en,'l-en');english.lang='en';english.dir='ltr';
    const hebrew=node('span',he,'l-he');hebrew.lang='he';hebrew.dir='rtl';
    element.replaceChildren(english,hebrew);
  }
  function pickerState(en, he) { bilingual($('sefaria-picker-state'),en,he); }
  function exportLink() {
    const version=selectedBook?.languages[$('reference-language').value];
    const box=$('selected-export');box.replaceChildren();
    if(version) {const a=link('Google export ↗',version.url);bilingual(a,'Google export ↗','יצוא Google ↗');box.append(a);}
  }
  function resetPassage() {
    ++pickerEpoch;++readerEpoch;selectedBook=null;selectedPassage=null;sectionList=[];
    $('sefaria-section').replaceChildren(option('', 'Choose a book first', 'בחרו תחילה חיבור'));
    $('sefaria-section').disabled=true;$('sefaria-section').removeAttribute('aria-busy');
    $('sefaria-levels').replaceChildren();$('selected-reference').textContent='';$('selected-export').replaceChildren();
    $('read-selection').disabled=true;$('retry-sefaria').hidden=true;
    pickerState('Choose a book to see its sections.','בחרו חיבור להצגת קטעיו.');
    for (const o of $('reference-language').options) o.disabled=false;
  }
  function bookOptions(selected = '') {
    const terms=normal($('sefaria-book-filter').value).split(/\s+/).filter(Boolean);
    const category=$('sefaria-category').value;
    const tanakhOrder=['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','I Samuel','II Samuel','I Kings','II Kings','Isaiah','Jeremiah','Ezekiel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Psalms','Proverbs','Job','Song of Songs','Ruth','Lamentations','Ecclesiastes','Esther','Daniel','Ezra','Nehemiah','I Chronicles','II Chronicles'];
    const priority=b=>{const i=tanakhOrder.indexOf(b.title);return i<0?100:i;};
    const matches=works.filter(b=>(!category || b.categories[0]===category) && terms.every(t=>normal(b.title+' '+(b.he_title||'')+' '+b.categories.join(' ')).includes(t)));
    if(category==='Tanakh') matches.sort((a,b)=>priority(a)-priority(b));
    const options=matches.map(b=>{
      const o=option(b.title, b.title+' · '+(b.he_title||b.title)+' — '+b.categories.slice(1).join(' › '), (b.he_title||b.title)+' · '+b.title+' — '+b.categories.slice(1).join(' › '));
      o.title=b.categories.join(' › ');return o;
    });
    $('sefaria-book').replaceChildren(option('', matches.length?'Choose a book…':'No matching books',matches.length?'בחרו חיבור…':'לא נמצאו חיבורים'),...options);
    $('sefaria-book').value=selected;$('sefaria-book').disabled=!matches.length;
    bilingual($('sefaria-book-count'),`${matches.length.toLocaleString()} books · all matches listed`,`${matches.length.toLocaleString()} חיבורים · כל התוצאות מוצגות`);
  }
  async function initPicker() {
    try {
      const c=await catalogue();works=c.works;
      const categories=[...new Set(works.map(b=>b.categories[0]))].sort();
      $('sefaria-category').replaceChildren(option('', 'All categories', 'כל הקטגוריות'),...categories.map(c=>option(c,c,categoryHebrew[c]||c)));
      $('sefaria-category').value='Tanakh';$('sefaria-category').disabled=false;$('sefaria-book-filter').disabled=false;
      resetPassage();bookOptions();
    } catch (_) {
      $('sefaria-state').textContent=text('Catalogue unavailable','הקטלוג אינו זמין');
      pickerState('The book catalogue could not be loaded. Try again or enter a reference manually.','לא ניתן לטעון את קטלוג החיבורים. נסו שוב או הזינו מראה מקום ידנית.');
      $('retry-sefaria').hidden=false;
    }
  }
  async function bookStructure(book) {
    if (!structures.has(book.title)) {
      const title=encodeURIComponent(book.title);
      const promise=Promise.all([
        json('https://www.sefaria.org/api/shape/'+title),
        json('https://www.sefaria.org/api/v2/raw/index/'+title).catch(()=>null)
      ]).then(([shape,index])=>SefariaNavigation.sections(shape,index)).catch(error=>{structures.delete(book.title);throw error;});
      structures.set(book.title,promise);
      if (structures.size>20) structures.delete(structures.keys().next().value);
    }
    return structures.get(book.title);
  }
  function choosePassage(passage, invalidate = true) {
    if(invalidate)++readerEpoch;selectedPassage=passage;
    $('selected-reference').textContent=passage.ref;
    $('read-selection').disabled=false;
  }
  function deeperChoices(parent, container, depth = 0) {
    if (depth>8) return;
    const choices=SefariaNavigation.children(parent);
    if (!choices.length) return;
    const label=node('label');const name=node('span');bilingual(name,'Narrow the passage (optional)','צמצום הקטע (רשות)');
    const select=node('select');select.id='sefaria-level-'+depth;label.htmlFor=select.id;
    select.append(option('', 'Whole selected section', 'כל הקטע שנבחר'),...choices.map((p,i)=>option(String(i),p.ref,p.ref)));
    const next=node('div');label.append(name,select);container.append(label,next);
    select.addEventListener('change',()=>{
      next.replaceChildren();const picked=select.value===''?parent:choices[Number(select.value)];
      choosePassage(picked);if(select.value!=='')deeperChoices(picked,next,depth+1);
    });
  }
  function selectSection(invalidate = true) {
    const section=sectionList[Number($('sefaria-section').value)];if(!section)return;
    $('sefaria-levels').replaceChildren();choosePassage(section,invalidate);deeperChoices(section,$('sefaria-levels'));
  }
  async function selectBook(book) {
    resetPassage();selectedBook=book;const epoch=pickerEpoch;const reader=readerEpoch;
    for (const o of $('reference-language').options) o.disabled=!book.languages[o.value];
    if(!book.languages[$('reference-language').value]) $('reference-language').value=book.languages.Hebrew?'Hebrew':'English';
    exportLink();
    $('sefaria-section').replaceChildren(option('', 'Loading sections…', 'טוענים קטעים…'));
    $('sefaria-section').setAttribute('aria-busy','true');
    pickerState('Loading the available sections…','טוענים את הקטעים הזמינים…');
    try {
      const sections=await bookStructure(book);if(epoch!==pickerEpoch)return false;
      sectionList=sections;
      $('sefaria-section').replaceChildren(...sections.map((p,i)=>option(String(i),p.en,p.he)));
      $('sefaria-section').disabled=false;$('sefaria-section').removeAttribute('aria-busy');
      selectSection(false);pickerState('Choose a section, then read the selected passage.','בחרו קטע ולחצו לקריאת הקטע שנבחר.');return {reader};
    } catch (_) {
      if(epoch!==pickerEpoch)return false;
      $('sefaria-section').replaceChildren(option('', 'Sections unavailable', 'הקטעים אינם זמינים'));
      $('sefaria-section').removeAttribute('aria-busy');
      pickerState('Sections could not be loaded. Try again or enter an exact reference manually.','לא ניתן לטעון את הקטעים. נסו שוב או הזינו מראה מקום מדויק ידנית.');
      $('retry-sefaria').hidden=false;return false;
    }
  }
  async function readSelection() {
    if(!selectedPassage || !selectedBook)return;
    const epoch=++readerEpoch;const ref=selectedPassage.ref;const language=$('reference-language').value;
    const version=selectedBook.languages[language];
    feedback(text('Reading the selected passage…','קוראים את הקטע שנבחר…'));
    try {
      await showDossier(await exactReference(ref,language,epoch),epoch,version?[link(text('Google export ↗','יצוא Google ↗'),version.url)]:[]);
    } catch(error) {if(epoch===readerEpoch)feedback(error.message);}
  }
  async function openBook(book) {
    // Search cards and the category browser use the same selection state.
    if(!works.length) { try {await initPicker();}catch(_){return;} }
    $('sefaria-category').value=book.categories[0];$('sefaria-book-filter').value='';bookOptions(book.title);
    const selection=await selectBook(book);
    if(selection && readerEpoch===selection.reader) await readSelection();
  }
  $('sefaria-category').addEventListener('change',()=>{resetPassage();bookOptions();});
  $('sefaria-book-filter').addEventListener('input',()=>{resetPassage();bookOptions();});
  $('sefaria-book').addEventListener('change',()=>{
    const book=works.find(b=>b.title===$('sefaria-book').value);
    if(book)selectBook(book);else resetPassage();
  });
  $('sefaria-section').addEventListener('change',selectSection);
  $('reference-language').addEventListener('change',()=>{++readerEpoch;exportLink();});
  $('sefaria-picker').addEventListener('submit',event=>{event.preventDefault();readSelection();});
  $('retry-sefaria').addEventListener('click',()=>selectedBook?selectBook(selectedBook):initPicker());
  $('source-search').addEventListener('submit',search);
  $('reference-form').addEventListener('submit',async event=>{
    event.preventDefault();const epoch=++readerEpoch;feedback(text('Resolving the exact reference…','מאתרים את מראה המקום המדויק…'));
    try {await showDossier(await exactReference($('exact-reference').value,$('reference-language').value,epoch),epoch);}
    catch(error) {if(epoch===readerEpoch)feedback(error.message);}
  });
  Promise.allSettled([sanhedrin(),initPicker()]).then(results=>{
    if(results[0].status==='rejected') $('sanhedrin-state').textContent=text('Temporarily unavailable','לא זמין כעת');
    if(results[1].status==='rejected') $('sefaria-state').textContent=text('Catalogue unavailable','הקטלוג אינו זמין');
    search();
  });
})();

