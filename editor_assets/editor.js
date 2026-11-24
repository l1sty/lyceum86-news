export function initializeEditor(workspace, authHeaders) {
  const el = id => workspace.querySelector('#' + id);
  let nonce, url;
  function update() {
    const size = el('body').value.trim().length;
    const limit = el('file').files.length ? 1000 : 4000;
    el('count').textContent = size + ' / ' + limit;
    el('review').disabled = !size || size > limit;
    nonce = crypto.randomUUID();
  }
  function setPhoto(figure, source, alt) {
    figure.replaceChildren();
    if (source) {
      const image = new Image();
      image.alt = alt;
      image.src = source;
      figure.append(image);
    }
    figure.hidden = !source;
  }
  function picture() {
    const file = el('file').files[0];
    if (url) URL.revokeObjectURL(url);
    if (file && file.size > 8 * 1024 * 1024) {
      el('status').textContent = 'Оберіть файл до 8 МБ.';
      el('file').value = '';
    } else el('status').textContent = '';
    const selected = el('file').files[0];
    url = selected ? URL.createObjectURL(selected) : '';
    el('thumbWrap').hidden = el('remove').hidden = !url;
    el('fileLabel').textContent = url ? 'Замінити фото' : 'Додати фото';
    setPhoto(el('thumbWrap'), url, 'Обране фото');
    update();
  }
  el('body').oninput = update;
  el('file').onchange = picture;
  el('remove').onclick = () => { el('file').value = ''; picture(); };
  function showPreview(show) {
    el('composer').hidden = show;
    el('confirmation').hidden = !show;
    el('title').textContent = show ? 'Попередній перегляд' : 'Нова публікація';
    el('status').textContent = '';
    window.scrollTo(0,0);
  }
  el('review').onclick = () => {
    el('previewText').textContent = el('body').value.trim();
    el('previewWrap').hidden = !url;
    setPhoto(el('previewWrap'), url, 'Фото до публікації');
    showPreview(true);
  };
  el('edit').onclick = () => showPreview(false);
  async function call(options = {}, path = '/api/editor') {
    const r = await fetch(path, {...options, headers: authHeaders()});
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw Error(data.error || 'Не вдалося виконати запит. Спробуйте ще раз.');
    }
    return r.json();
  }
  el('publish').onclick = async () => {
    const data = new FormData();
    data.set('text', el('body').value.trim());
    data.set('nonce', nonce);
    if (el('file').files.length) data.set('photo', el('file').files[0]);
    el('publish').disabled = el('edit').disabled = true;
    el('status').textContent = 'Публікуємо…';
    try {
      await call({method:'POST', body:data});
      el('confirmation').hidden = true;
      el('title').textContent = 'Опубліковано';
      el('status').textContent = 'Новина у стрічці. Розсилку підписникам додано до черги.';
      el('next').hidden = false;
    } catch (err) {el('status').textContent = err.message;}
    finally {el('publish').disabled = el('edit').disabled = false;}
  };
  el('next').onclick = () => {
    el('body').value = el('file').value = '';
    picture(); el('next').hidden = true; showPreview(false); el('body').focus();
  };
  const tabs = [...workspace.querySelectorAll('[data-view]')];
  for (const tab of tabs) tab.onclick = () => {
    if (tab.getAttribute('aria-pressed') === 'true') return;
    for (const other of tabs) {
      const active = other === tab;
      el(other.dataset.view).hidden = !active;
      other.setAttribute('aria-pressed', String(active));
    }
    if (tab.dataset.view === 'pollview') loadList('polls');
    if (tab.dataset.view === 'caseview' && !pages.cases) loadList('cases');
    if (tab.dataset.view === 'statsview') loadStats();
  };

  async function loadStats() {
    const list = el('audience-stats'), message = el('stats-message');
    list.replaceChildren();
    message.textContent = 'Завантажуємо статистику…';
    try {
      const stats = await call({}, '/api/stats');
      const captions = {
        total: 'Усього користувачів',
        day: 'Активні за 24 години',
        week: 'Активні за 7 днів',
        starters: 'Запускали бота через /start',
        subscribers: 'Підписники'
      };
      for (const [key, label] of Object.entries(captions)) {
        const card = node('div', undefined, list);
        node('dt', label, card);
        node('dd', String(stats[key]), card);
      }
      message.textContent = '';
    } catch (error) {
      message.textContent = error.message;
    }
  }
  function node(name, text, parent, klass) {
    const child = document.createElement(name);
    if (text !== undefined) child.textContent = text;
    if (klass) child.className = klass;
    parent.append(child);
    return child;
  }
  function renderPoll(item, parent) {
    const article = node('article',undefined,parent,'item');
    const total = Object.values(item.counts).reduce((a,b)=>a+b,0);
    node('h3',item.question,article);
    node('small','Усього голосів — '+total,article);
    item.options.forEach((label,i)=>{
      const count = item.counts[i] || 0;
      const row = node('div',undefined,article,'row');
      node('span',label,row); node('span',String(count),row,'meta');
      const bar = node('meter',undefined,article);
      bar.max = total || 1; bar.value = count; bar.setAttribute('aria-label',label);
    });
    const remove = node('button','Видалити опитування',article);
    remove.onclick = async () => {
      if (!window.confirm('Видалити опитування «'+item.question+'» та всі його голоси?')) return;
      remove.disabled = true;
      try {
        await call({method:'DELETE'},'/api/polls/'+item.id);
        article.remove();
        await loadList('polls');
      } catch (e) {
        el('pollsError').textContent = e.message;
        remove.disabled = false;
      }
    };
  }
  function renderCase(item, parent) {
    const card = node('details',undefined,parent);
    const summary = node('summary','№ '+item.id+' · '+item.body.split('\n')[0]+' — '+item.state,card);
    node('p',item.body,card,'casebody');
    const form = node('form',undefined,card);
    const select = node('select',undefined,node('label','Статус',form));
    for (const state of ['Отримано','Розглядаємо','Є відповідь']) node('option',state,select);
    select.value=item.state;
    const answer = node('textarea',undefined,node('label','Відповідь учневі',form));
    answer.value=item.answer; answer.maxLength=2000;
    const save=node('button','Зберегти',form,'primary');
    const notice=node('p','',form,'notice'); notice.setAttribute('role','status');
    form.oninput=()=>{form.dataset.dirty='true'; notice.textContent='Є незбережені зміни';};
    form.onsubmit=async ev=>{
      ev.preventDefault(); save.disabled=select.disabled=answer.disabled=true;
      form.dataset.saving='true';
      const data=new FormData();
      data.set('id',item.id); data.set('version',item.version);
      data.set('state',select.value); data.set('answer',answer.value.trim());
      try {
        await call({method:'POST',body:data},'/api/cases');
        item.version++; summary.textContent='№ '+item.id+' · '+item.body.split('\n')[0]+' — '+data.get('state');
        delete form.dataset.dirty;
        notice.textContent='Зміни збережено';
      } catch(e){notice.textContent=e.message;}
      finally{delete form.dataset.saving;save.disabled=select.disabled=answer.disabled=false;}
    };
  }
  const pages={};
  async function loadList(kind, before) {
    const list=el(kind+'List'), more=el(kind+'More');
    const error=el(kind+'Error'), refresh=workspace.querySelector('[data-refresh="'+kind+'"]');
    if (!before && list.querySelector('[data-saving]')) {
      error.textContent='Дочекайтеся завершення збереження.';
      return;
    }
    error.textContent='';
    const generation=Symbol();
    pages[kind]=generation;
    refresh.disabled=more.disabled=true;
    list.setAttribute('aria-busy','true');
    if (!before) list.inert=true;
    try {
      const result=await call({},'/api/'+kind+(before?'?before='+before:''));
      if (pages[kind]!==generation) return;
      if (!before) list.replaceChildren();
      more.hidden=true;
      const draw=kind==='polls'?renderPoll:renderCase;
      result.items.forEach(item=>draw(item,list));
      if (!before && !result.items.length) node('p',kind==='polls'?'Опитувань поки немає':'Звернень поки немає',list,'meta');
      if (result.has_more) {more.hidden=false;more.onclick=()=>loadList(kind,result.items.at(-1).id);}
    } catch(e){if(pages[kind]===generation) error.textContent=e.message;}
    finally{
      if(pages[kind]===generation){
        refresh.disabled=more.disabled=false;
        list.setAttribute('aria-busy','false');
        list.inert=false;
      }
    }
  }
  workspace.querySelectorAll('[data-refresh]').forEach(b=>b.onclick=()=>{
    if (b.dataset.refresh==='cases' && el('casesList').querySelector('[data-dirty]') &&
        !window.confirm('Оновити список і відкинути незбережені зміни?')) return;
    loadList(b.dataset.refresh);
  });
  let pollNonce=crypto.randomUUID();
  el('pollform').oninput=()=>{pollNonce=crypto.randomUUID();};
  el('pollform').onsubmit=async ev=>{
    ev.preventDefault();
    const form=ev.currentTarget, data=new FormData(form);
    const options=el('choices').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    options.forEach(s=>data.append('option',s));
    data.set('nonce',pollNonce);
    const controls = [...form.querySelectorAll('input,textarea,button')];
    controls.forEach(control=>control.disabled=true);
    try {
      await call({method:'POST',body:data},'/api/polls');
      form.reset();pollNonce=crypto.randomUUID();
      el('pollmsg').textContent='Опитування опубліковано';
      await loadList('polls');
    } catch(e){el('pollmsg').textContent=e.message;}
    finally{controls.forEach(control=>control.disabled=false);}
  };

  const access = el('editor-access');
  const tabGroup = workspace.querySelector('.editor-tabs');
  const content = workspace.querySelector('.editor-content');
  return async function checkAccess() {
    try {
      await call();
      tabs.forEach(tab => { tab.disabled = false; });
      el('composer').disabled = false;
      access.textContent = '';
      access.hidden = true;
      tabGroup.hidden = content.hidden = false;
      if (!nonce) update();
    } catch (error) {
      tabGroup.hidden = content.hidden = true;
      access.textContent = error.message;
      access.hidden = false;
    }
  };
}
