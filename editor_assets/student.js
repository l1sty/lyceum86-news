const themeColors={
 red:['Червоний',355], orange:['Помаранчевий',27], yellow:['Жовтий',48],
 green:['Зелений',140], sky:['Блакитний',194], blue:['Синій',216],
 violet:['Фіолетовий',270], pink:['Рожевий',328]
};
function applyTheme(key){
 if(!Object.hasOwn(themeColors,key))key='blue';
 document.documentElement.dataset.theme=key;
 document.documentElement.style.setProperty('--hue',themeColors[key][1]);
}
let initialTheme='blue';
try{initialTheme=localStorage.getItem('lyceum-theme')||'blue'}catch{}
applyTheme(initialTheme);
const paths = {
 heart:'M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 6l-1.1-1.2a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z',
 bell:'M5 17h14l-2-3v-4a5 5 0 0 0-10 0v4l-2 3Zm5 3q2 2 4 0',
 news:'M5 4h15v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8h2Zm0 0v14m4-10h7m-7 4h7m-7 4h4',
 polls:'M4 4v16h16M8 15v-4m5 4V6m5 9V9',feedback:'M21 11a9 8 0 0 1-13 7l-5 2 1-5a9 8 0 1 1 17-4Z',
 status:'M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0Z',
 home:'M2 11l10-8 10 8M5 10v11h5v-7h4v7h5V10',user:'M16 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0ZM4 21c0-8 16-8 16 0',
 users:'M14 8a4 4 0 1 1-8 0 4 4 0 1 1 8 0ZM2 20c0-8 16-8 16 0m-1-15q5 2 2 7m0 3q3 1 3 5',
 mute:'M3 3l18 18M7 9v5l-2 3h12m0-5v-2a5 5 0 0 0-6-5m-1 15q2 2 4 0',
 editor:'M4 20l5-1L21 7l-4-4L5 15l-1 5Zm10-14 4 4',game:'M6 7h12c4 0 6 14 1 12l-4-4H9l-4 4C0 21 2 7 6 7Zm1 3v4m-2-2h4m7-1h.1m2 2h.1'
};
function icon(key){
 return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="'+paths[key]+'"/></svg>';
}
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const actions={
 valentines:['heart','Анонімні валентинки'],
 news:['news','Останні новини'],polls:['polls','Опитування'],feedback:['feedback','Скарги та пропозиції'],status:['status','Статус звернення'],
 subscribe:['bell','Підписатися','Отримувати оголошення'],unsubscribe:['mute','Відписатися','Вимкнути розсилку'],
 editor:['editor','Редакція'],game:['game','Монополія'],mafia:['users','Мафія']
};
const params=new URLSearchParams(location.search);
let launch=params.get('launch')||'';
try{
 if(launch)sessionStorage.setItem('school-launch',launch);
 else launch=sessionStorage.getItem('school-launch')||'';
}catch{}
let staff=params.get('editor')==='1'?['editor']:[];
const pages={
 news:['Останні новини','Оголошення редакції ліцею.','',[]],
 feedback:['Скарги та пропозиції','Напишіть редакції ліцею.','',[]],
 polls:['Опитування','Оберіть відповідь, щоб проголосувати.','',[]],
 status:['Статус звернення','Введіть код, який отримали після надсилання.','',[]],
 editor:['Редакція','','',[]],
 home:['Простір ліцею','','Сервіси ліцею',['polls','feedback','status','subscribe']],
 community:['Спільнота','','',['polls','feedback','status']],
 entertainment:['Розваги','','',['mafia','game','valentines']],
 valentines:['Анонімні валентинки','Отримувач побачить лише текст вашої валентинки.','',[]],
 profile:['Мій профіль','','Керування підпискою',['subscribe','unsubscribe']]
};
const notice=document.querySelector('#notice');
const themeName=document.querySelector('#theme-name');
for(const [key,[name,hue]] of Object.entries(themeColors)){
 const label=document.createElement('label');
 label.title=name;
 label.style.setProperty('--sample',hue);
 const radio=document.createElement('input');
 radio.type='radio';radio.name='theme';radio.value=key;
 radio.setAttribute('aria-label',name);
 radio.checked=key===document.documentElement.dataset.theme;
 if(radio.checked)themeName.textContent=name;
 radio.onchange=()=>{
   applyTheme(key);themeName.textContent=name;
   try{localStorage.setItem('lyceum-theme',key)}catch{}
 };
 const swatch=document.createElement('span');swatch.setAttribute('aria-hidden','true');
 label.append(radio,swatch);document.querySelector('.swatches').append(label);
}
const form=document.querySelector('#case-form');
const receipt=document.querySelector('.receipt');
const editorWorkspace=document.querySelector('#editor-workspace');
let editorAccess, editorLoading=false;
async function openEditor(){
 if(editorLoading)return;
 editorLoading=true;
 try{
   if(!editorAccess){
     const {initializeEditor}=await import('/app/assets/editor.js');
     editorAccess=initializeEditor(editorWorkspace,authHeaders);
   }
   await editorAccess();
 }catch{
   editorWorkspace.querySelector('#access-retry').hidden=false;
   editorWorkspace.querySelector('#editor-access').textContent='Не вдалося завантажити редакцію. Відкрийте її ще раз.';
 }finally{
   editorLoading=false;
 }
}
editorWorkspace.querySelector('#access-retry').onclick=openEditor;
function privacyNote(){
 document.querySelector('#privacy-note').textContent=form.elements.kind.value==='anonymous'
   ? 'Редактори отримають лише текст. Для анонімності не вказуйте свої контакти.'
   : 'Редактори отримають текст і ваш Telegram ID.';
}
form.addEventListener('change',privacyNote);
privacyNote();
function authHeaders(){
 return {
   'X-Student-Launch':launch,
   'X-Telegram-Init-Data':window.Telegram?.WebApp?.initData||''
 };
}
function retryState(view,message,retry){
 const description=document.createElement('p');
 description.textContent=message;
 const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Повторити';button.onclick=retry;
 view.replaceChildren(description,button);
}
function studentRequest(path,options={}){
 return fetch('/app/api/'+path,{...options,headers:authHeaders()});
}
async function requestData(path, fields){
 const options=fields?{method:'POST',body:new URLSearchParams(fields)}:{};
 let response,data;
 try{response=await studentRequest(path,options);data=await response.json()}
 catch{throw new Error('Не вдалося з’єднатися із сервером. Перевірте інтернет і спробуйте ще раз.')}
 if(!response.ok)throw new Error(data.error||'Дія тимчасово недоступна.');
 return data;
}
let pollLoad=0;
async function loadPolls(){
 const generation=++pollLoad;
 const view=document.querySelector('#poll-view');
 view.textContent='Завантажуємо опитування…';
 try{
   const {items}=await requestData('polls');
   if(generation!==pollLoad)return;
   view.textContent=items.length?'':'Активних опитувань поки немає.';
   for(const poll of items){
     const card=document.createElement('article');card.className='post';
     const heading=document.createElement('h2');heading.textContent=poll.question;card.append(heading);
     poll.options.forEach((option,choice)=>{
       const button=document.createElement('button');button.className='poll-option';
       button.textContent=option;button.setAttribute('aria-pressed',choice===poll.choice);
       button.onclick=async()=>{
         const buttons=card.querySelectorAll('button');
         buttons.forEach(item=>item.disabled=true);
         try{
           const {message}=await requestData('polls',{poll:poll.id,choice});
           buttons.forEach(item=>item.setAttribute('aria-pressed',item===button));
           if(!view.hidden && generation===pollLoad)notice.textContent=message;
         }catch(error){if(!view.hidden && generation===pollLoad)notice.textContent=error.message}
         finally{buttons.forEach(item=>item.disabled=false)}
       };
       card.append(button);
     });
     view.append(card);
   }
 }catch(error){if(generation===pollLoad)retryState(view,error.message,loadPolls)}
}
document.querySelector('#lookup-form').onsubmit=async event=>{
 event.preventDefault();
 const form=event.currentTarget;
 const submit=form.querySelector('button');
 if(submit.disabled)return;
 submit.disabled=true;
 const result=document.querySelector('#case-result');
 result.hidden=false;result.textContent='Перевіряємо статус…';
 try{
   const {state,answer}=await requestData('status',{code:form.elements.code.value});
   result.textContent=answer?state+'\n\n'+answer:state;
 }catch(error){result.textContent=error.message}
 finally{submit.disabled=false}
};
let feedRequest;
let photos=[];
async function loadPhoto(figure, id, signal){
 try{
   const response=await studentRequest('news/'+id+'/photo',{signal});
   if(!response.ok)throw new Error();
   const blob=await response.blob();
   if(signal.aborted)return;
   const url=URL.createObjectURL(blob);photos.push(url);
   const img=new Image();img.alt='Фото до оголошення';img.decoding='async';img.src=url;
   figure.replaceChildren(img);
 }catch{if(!signal.aborted)figure.textContent='Фото тимчасово недоступне.'}
 finally{figure.removeAttribute('aria-busy')}
}
async function loadNews(){
 const feed=document.querySelector('#feed');
 const controller=feedRequest=new AbortController();
 const options={signal:controller.signal};
 feed.textContent='Завантажуємо новини…';
 try{
   const response=await studentRequest('news',options);
   const data=await response.json();
   if(!response.ok)throw new Error(data.error);
   feed.textContent=data.items.length?'':'Оголошень поки немає.';
   for(const item of data.items){
     const article=document.createElement('article');article.className='post';article.textContent=item.body;
     feed.append(article);
     if(item.photo){
       const figure=document.createElement('figure');
       figure.className='news-photo';figure.textContent='Завантажуємо фото…';
       figure.setAttribute('aria-busy','true');article.append(figure);
       void loadPhoto(figure,item.id,controller.signal);
     }
   }
 }catch(error){if(!controller.signal.aborted)retryState(feed,error.message?.startsWith('Для доступу')?error.message:'Не вдалося завантажити новини.',loadNews)}
}
let nonce;
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(form.querySelector('button').disabled)return;
 const data=new FormData(form);
 nonce=nonce||crypto.randomUUID();data.set('nonce',nonce);
 form.querySelector('button').disabled=true;notice.textContent='';
 try{
   const response=await studentRequest('feedback',{method:'POST',body:data});
   const result=await response.json();
   if(!response.ok){notice.textContent=result.error;return}
   receipt.querySelector('code').textContent=result.code;receipt.hidden=false;form.hidden=true;
   document.querySelector('#lookup-form').elements.code.value=result.code;
 }catch{notice.textContent='Не вдалося підтвердити надсилання. Спробуйте ще раз.'}
 finally{form.querySelector('button').disabled=false}
});
document.querySelector('#new-case').onclick=()=>{
 nonce=null;form.reset();privacyNote();receipt.hidden=true;form.hidden=false;
};
function displayProfile(profile){
 document.querySelector('#poll-count').textContent=profile.polls;
 document.querySelector('#subscription').textContent=profile.subscribed?'Активна':'Вимкнена';
 const id=document.querySelector('#telegram-id');
 id.textContent='Telegram ID · '+profile.id;id.hidden=false;
 document.querySelector('#stats-note').textContent='';
}
let transition;
const parentPages={news:'home',editor:'home',valentines:'entertainment',feedback:'community',polls:'community',status:'community'};
const telegram=window.Telegram?.WebApp;
const backButton=telegram?.isVersionAtLeast?.('6.1') ? telegram.BackButton : null;
let openedFrom;
backButton?.onClick(()=>{
 const modal=document.querySelector('dialog[open]');
 if(modal){modal.close();return}
 if(history.state?.schoolParent){history.back();return}
 const parent=parentPages[document.body.dataset.page];
 if(parent)location.hash=parent;
});
function render(focus){
 const route=location.hash.slice(1);
 const key=Object.hasOwn(pages,route)?route:document.body.dataset.initialPage;
 const [title,intro,section,items]=pages[key];
 document.body.dataset.page=key;
 if(openedFrom){
   history.replaceState({...history.state,schoolParent:openedFrom},'');
   openedFrom=null;
 }
 const parent=history.state?.schoolParent||parentPages[key]||key;
 if(parentPages[key])backButton?.show();else backButton?.hide();
 document.title=title+' · Ліцей №86';
 feedRequest?.abort();photos.forEach(url=>URL.revokeObjectURL(url));photos=[];
 document.querySelector('#feed').hidden=key!=='news';
 document.querySelector('#case-view').hidden=key!=='feedback';
 document.querySelector('#poll-view').hidden=key!=='polls';
 document.querySelector('#val-view').hidden=key!=='valentines';
 if(key==='valentines')valentinesInbox.refresh();
 document.querySelector('#lookup-view').hidden=key!=='status';
 const enteringEditor=key==='editor'&&editorWorkspace.hidden;
 editorWorkspace.hidden=key!=='editor';
 if(enteringEditor)openEditor();
 document.querySelector('#section-title').hidden=!section;
 if(key==='news')loadNews();
 if(key==='polls')loadPolls();
 const heading=document.querySelector('#heading');
 heading.textContent=title;
 const subtitle=document.querySelector('.intro');
 subtitle.textContent=intro;
 subtitle.hidden=!intro;
 document.querySelector('.feature').hidden=key!=='home';
 document.querySelector('#profile-stats').hidden=key!=='profile';
 if(key==='profile')requestData('profile').then(displayProfile).catch(error=>{
   retryState(document.querySelector('#stats-note'),error.message,()=>render(false));
 });
 document.querySelector('#section-title').textContent=section;
 notice.textContent='';
 const visibleItems=['home','community'].includes(key)?[...items,...staff]:items;
 document.querySelector('.grid').innerHTML=visibleItems.map(id=>{
   const [glyph,label,hint]=actions[id];
   return '<button class="tile" data-action="'+id+'"><i class="tile-icon">'+icon(glyph)+'</i><span>'+label+(hint?'<small>'+hint+'</small>':'')+'</span><b class="arrow" aria-hidden="true">→</b></button>';
 }).join('');
 document.querySelectorAll('nav a').forEach(link=>{
   if(link.hash==='#'+parent){
     link.setAttribute('aria-current','page');
   }else link.removeAttribute('aria-current');
 });
 if(focus){window.scrollTo(0,0);heading.focus({preventScroll:true})}
 if(focus && !matchMedia('(prefers-reduced-motion: reduce)').matches){
   transition?.cancel();
   transition=document.querySelector('main').animate?.([{opacity:.8,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:150,easing:'ease-out'});
 }
}
let valentinesInbox;
addEventListener('DOMContentLoaded',()=>{
 valentinesInbox=window.initializeValentines(requestData,params.get('to'));
 const tg=window.Telegram?.WebApp;
 if(tg?.isVersionAtLeast?.('6.9'))tg.setHeaderColor('#f6f5f0');
 if(tg?.isVersionAtLeast?.('6.1'))tg.setBackgroundColor('#f6f5f0');
 tg?.ready();tg?.expand();
 render(false);
 if(launch||tg?.initData)requestData('profile').then(profile=>{
   if(profile.editor&&!staff.length){
     staff=['editor'];
     if(['home','community'].includes(document.body.dataset.page))render(false);
   }
 }).catch(()=>{});
 document.addEventListener('click', event=>{
   if(event.target.closest('button:enabled, nav a, .swatches label') && tg?.isVersionAtLeast?.('6.1'))tg.HapticFeedback?.selectionChanged();
 });
 document.addEventListener('click',async event=>{
   const button=event.target.closest('[data-action]');
   if(!button)return;
   const action=button.dataset.action;
   if(Object.hasOwn(parentPages,action)){
     openedFrom=document.body.dataset.page;
     location.hash=action;return
   }
   if(action==='game'){location.assign('/game/');return}
   if(action==='mafia'){
     if(!tg?.initData && tg?.platform && tg.platform!=='unknown'){tg.sendData('mafia');return}
     location.assign('/mafia/');return
   }
   const controls=[...document.querySelectorAll('[data-action=subscribe],[data-action=unsubscribe]')];
   controls.forEach(control=>control.disabled=true);
   try{
     const profile=await requestData('profile',{action});
     displayProfile(profile);
     notice.textContent=profile.subscribed?'Підписку увімкнено.':'Підписку вимкнено.';
   }catch(error){notice.textContent=error.message}
   finally{controls.forEach(control=>control.disabled=false)}
 });
});
addEventListener('hashchange',()=>render(true));
