import {surface, count, still, cancelMotion, disposeUI} from './interface-motion.js';
import {gameFeedback} from './feedback.js';
const $=s=>document.querySelector(s), tg=window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const feedback=gameFeedback(tg,$('#sound'));
const colors=['#90aeff','#64d5a2','#c7a5ff','#ffbd73','#ff948f','#6ed8ee'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currency=new Intl.NumberFormat('uk-UA');
const money=n=>currency.format(n)+' ₴';
const modeName=m=>m==='quick'?'Швидка':'Класична';
const dialog=$('dialog'), sheet=$('#sheet');
let lobby, room, board, roomTab='log', lobbyTab='rooms', busy=false, polling=false, epoch=0, scene, fallback=false, lastVisual, rosterRoom, turnId, resultKey, statusKey, actionKey;
let offset=0, connectionFailed=false;
let deedSignature='';
let feedMarkup, listingMarkup;
const ticketKey='lyceum.game.'+(tg?.initDataUnsafe?.user?.id||'session');
let ticket='';
try{ticket=sessionStorage.getItem(ticketKey)||''}catch{}
let closingSheet=false;
function dismissSheet(){
  if(!dialog.open||closingSheet)return;
  closingSheet=true;
  surface(dialog,{y:9,scale:.992},{duration:.12,type:'tween',ease:'easeIn'},()=>{
    if(closingSheet&&dialog.open)dialog.close();
    closingSheet=false;
  });
}
dialog.addEventListener('cancel',e=>{e.preventDefault();dismissSheet()});
dialog.querySelector('.dialog-head').addEventListener('submit',e=>{e.preventDefault();dismissSheet()});
function error(message=''){const el=$('#error');el.textContent=message;el.hidden=!message}
async function api(path,data){
  const options={headers:{'X-Telegram-Init-Data':tg?.initData||'','X-Game-Session':ticket},cache:'no-store'};
  if(AbortSignal.timeout)options.signal=AbortSignal.timeout(12000);
  if(data){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(data)}
  let r;try{r=await fetch('/game/api/'+path,options)}catch{throw Error('Зв’язок перервано. Відновлюємо з’єднання…')}
  const date=Date.parse(r.headers.get('Date'));if(Number.isFinite(date))offset=date+500-Date.now();
  const session=r.headers.get('X-Game-Session');if(session){ticket=session;try{sessionStorage.setItem(ticketKey,session)}catch{}}
  if(r.status===204)return null;
  const result=await r.json().catch(()=>({error:'Сервер тимчасово недоступний.'}));
  if(!r.ok){if(r.status===403){$('main').hidden=true;$('#access-status').hidden=false;$('#access-status').textContent=result.error}const err=Error(result.error||'Не вдалося виконати дію.');err.status=r.status;throw err}
  return result;
}
function modal(html,section='Місто',refreshing=false){
  const opening=!dialog.open;
  const reversing=closingSheet;
  closingSheet=false;
  delete sheet.dataset.tile;
  sheet.innerHTML=html;
  sheet.querySelector('h2').id='dialog-title';
  $('#sheet-section').textContent=section;
  if(!dialog.open)dialog.showModal();
  dialog.scrollTop=0;
  if(opening){dialog.style.transform='';surface(dialog,{y:[16,0],scale:[.988,1]})}
  else if(reversing)surface(dialog,{y:0,scale:1});
  else if(!refreshing)surface(sheet,{x:[7,0]});
}
function btn(label,act,primary=false,disabled=false){return '<button data-act="'+act+'" class="'+(primary?'primary':'')+'" '+(disabled?'disabled':'')+'>'+label+'</button>'}
const me=()=>room?.players.find(p=>p.id===lobby?.me);
const active=()=>room?.players[room.turn];
const mine=()=>active()?.id===lobby?.me;
const ownerName=id=>room?.players.find(p=>p.id===id)?.name||'Вільна ділянка';
const districtColors=['#d39b65','#71b59d','#829fe0','#d58a91'];
const labels=document.createElement('div');
labels.className='labels';
$('#stage').append(labels);
let labelPositions, labelVersion, railTile, lastOwners, captionKey;
const tileMarkup=new WeakMap();
const labelBoxes=[];
const labelSize=new ResizeObserver(entries=>{
  for(const entry of entries){
    const size=entry.borderBoxSize?.[0];
    if(!size?.inlineSize)continue;
    const box=labelBoxes[Number(entry.target.dataset.tile)];
    if(box){box.w=size.inlineSize;box.h=size.blockSize}
  }
  if(labelPositions && !fallback)placeLabels(...labelPositions);
});
function placeLabels(points,width,height){
  labelPositions=[points,width,height];
  for(const box of labelBoxes){
    const [x,y]=points[box.tile];
    const margin=width<760 ? -22 : 10;
    box.visible=x>=margin && y>=margin && x<=width-margin && y<=height-margin;
    box.x=x;box.y=y;
  }
  // Long Ukrainian names need extra clearance on the foreshortened edges.
  // Work in projected pixels with cached border boxes, without measuring layout per frame.
  if(width>=760 && height>=420){
    for(let pass=0;pass<5;pass++){
      let overlap=false;
      for(let i=0;i<labelBoxes.length;i++)for(let j=i+1;j<labelBoxes.length;j++){
        const a=labelBoxes[i], b=labelBoxes[j];
        if(!a.visible||!b.visible)continue;
        const dx=b.x-a.x,dy=b.y-a.y;
        const spread=Math.min((a.w+b.w+5)/(2*Math.max(.01,Math.abs(dx))),
          (a.h+b.h+5)/(2*Math.max(.01,Math.abs(dy))))-1;
        if(spread<=.001)continue;
        const x=dx*spread*.5,y=dy*spread*.5;
        a.x-=x;b.x+=x;a.y-=y;b.y+=y;overlap=true;
      }
      if(!overlap)break;
    }
  }
  for(const box of labelBoxes){
    const label=labels.children[box.tile];
    label.hidden=!box.visible;
    if(!box.visible)continue;
    const x=Math.max(box.w/2,Math.min(width-box.w/2,box.x));
    const y=Math.max(box.h/2,Math.min(height-box.h/2,box.y));
    label.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px) translate(-50%,-50%)';
  }
}
function renderTiles(){
  if(!board)return;
  const version=JSON.stringify([room?.deeds,room?.players.map(p=>[p.id,p.name]),fallback]);
  const changed=version!==labelVersion;
  if(changed){
    const rail=$('#tile-rail');
    const hosts=fallback?[$('#flat'),rail]:[labels,rail];
    for(const host of hosts){
      const overlay=host===labels;
      board.forEach((tile,i)=>{
        const html=tileButton(tile,i,overlay), current=host.children[i];
        if(current && tileMarkup.get(current)===html)return;
        const template=document.createElement('template');template.innerHTML=html;
        const next=template.content.firstElementChild;
        if(current){
          current.className=next.className;current.style.cssText=next.style.cssText;
          current.setAttribute('aria-label',next.getAttribute('aria-label'));current.replaceChildren(...next.childNodes);
        }else{
          host.append(next);
          if(overlay){labelBoxes[i]={tile:i,w:22,h:22};labelSize.observe(next)}
        }
        const button=current||next;tileMarkup.set(button,html);
        const deed=room?.deeds[i], before=lastOwners?.deeds[i];
        if(deed && lastOwners?.code===room.code && (deed.owner!==before?.owner||deed.level!==before?.level)){
          const label=button.querySelector(overlay?'.index':'.label-copy');
          surface(label,{y:[3,0]});
          if(host.id==='flat')feedback.cue(before?.level<deed.level?'build':'claim');
        }
      });
    }
    lastOwners=room?{code:room.code,deeds:room.deeds}:null;
    if(!fallback && labelPositions)placeLabels(...labelPositions);
    labelVersion=version;
  }
  const tile=room?.deadline?active().pos:null;
  if(!changed && tile===railTile)return;
  for(const host of [fallback?$('#flat'):labels,$('#tile-rail')]){
    host.querySelector('.current-tile')?.classList.remove('current-tile');
    if(tile!==null)host.children[tile]?.classList.add('current-tile');
  }
  if(tile!==railTile && tile!==null){
    const rail=$('#tile-rail'), cell=rail.children[tile];
    rail.scrollTo({left:cell.offsetLeft-rail.offsetLeft,behavior:still()?'instant':'smooth'});
  }
  railTile=tile;
}
function tileButton(tile,i,overlay){
    const deed=room?.deeds[i];
    const owner=deed&&room.players.findIndex(p=>p.id===deed.owner);
    const value=tile.price?money(tile.price):tile.district;
    const ownerLabel=deed?ownerName(deed.owner):tile.price?'Вільна ділянка':'';
    const name=(i+1)+'. '+tile.name;
    return '<button data-tile="'+i+'" class="'+(overlay?'tile-label ':'')+(deed?'owned':'')+
      '" style="--tile:'+districtColors[Math.floor(i/5)]+';--owner:'+(deed?colors[owner]:'transparent')+
      '" aria-label="'+esc([name,value,ownerLabel].filter(Boolean).join(' · '))+'">'+
      (overlay?'<span class="index">'+(i+1)+'</span>':'')+
      '<span class="label-copy">'+esc(overlay?tile.name:name)+'</span><small>'+esc(value)+
      (deed?'<span class="owner-dot" aria-hidden="true"></span>':'')+'</small>'+
      (!overlay&&ownerLabel?'<small>'+esc(ownerLabel)+'</small>':'')+'</button>';
}
function deedState(i){
  return JSON.stringify([room?.code,room?.phase,room?.turn,room?.deeds[i],me()?.cash,room?.players.map(p=>p.out)]);
}
function detail(i){
  if(!board)return;const tile=board[i],d=room?.deeds[i];
  const refreshing=dialog.open&&sheet.dataset.tile===String(i);
  const previousForm=refreshing?$('#offer'):null;
  const draft=previousForm?new FormData(previousForm):null;
  const focused=previousForm?.contains(document.activeElement)?document.activeElement.name:null;
  const previousScroll=dialog.scrollTop;
  const district=districtColors[Math.floor(i/5)];
  let html='<div class="deed-head" style="--district:'+district+'"><div class="eyebrow">'+esc(tile.district)+'</div><h2>'+esc(tile.name)+'</h2></div>';
  if(scene && tile.price)html+='<img class="deed-view" src="'+scene.portrait(i)+'" alt="">';
  if(tile.price){
    html+='<div class="stats"><div><small>Ціна ділянки</small><strong>'+money(tile.price)+'</strong></div><div><small>Оренда за візит</small><strong>'+money(tile.rent*(1+(d?.level||0)))+'</strong></div></div><div class="property-owner"><strong>'+esc(ownerName(d?.owner))+'</strong>'+(d?'<small>Рівень '+d.level+' із 3</small>':'')+'</div>';
    if(d && d.owner===lobby.me && mine() && room.phase==='roll'){
      html+=btn('Поліпшити · '+money(tile.upgrade),'upgrade',true,d.level>=3||me().cash<tile.upgrade);
      html+='<form id="offer"><h3>Продаж ділянки</h3><label>Кому запропонувати<select name="to">'+room.players.filter(p=>p.id!==lobby.me&&!p.out).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></label><label>Ціна продажу, ₴<input name="amount" type="number" inputmode="numeric" min="1" max="1000000" value="'+tile.price+'" required></label><button>Надіслати пропозицію</button></form>';
    }
  }else html+='<p>'+({'Подія':'Випадкова шкільна подія змінює баланс.','Старт':'Кожне завершене коло приносить 160 ₴.','Відпочинок':'Тут можна перепочити без плати за оренду.'}[tile.district])+'</p>';
  modal(html,'Клітинка '+(i+1)+' із '+board.length,refreshing);sheet.dataset.tile=i;deedSignature=deedState(i);
  const form=$('#offer');
  if(draft&&form){
    form.elements.amount.value=draft.get('amount');
    const recipient=draft.get('to');
    if([...form.elements.to.options].some(option=>option.value===recipient))form.elements.to.value=recipient;
    if(focused)form.elements.namedItem(focused)?.focus({preventScroll:true});
  }
  if(refreshing)dialog.scrollTop=previousScroll;
}
function catalog(){
  if(!board)return;
  modal('<h2>Ділянки міста</h2><div class="catalog">'+board.map((tile,i)=>tileButton(tile,i,false)).join('')+'</div>');
}
$('#catalog').onclick=catalog;
$('#help').onclick=()=>modal('<h2>Правила гри</h2><p>Зберіть 2–6 учасників. Кожен починає з 900 ₴. Кидайте кубики, купуйте шкільні ділянки й отримуйте оренду. За коло нараховується 160 ₴.</p><p>Відмовтеся від купівлі, щоб почати аукціон. Перемагає найбільша ставка на момент завершення торгів. Мінімальний крок — 10 ₴.</p><p>Перед кидком відкрийте свою ділянку у вкладці «Власність», щоб поліпшити її або запропонувати продаж іншому гравцеві. Кидок закриває пропозицію.</p><p>Якщо грошей бракує на обов’язковий платіж, гравець вибуває. У класичній грі перемагає останній учасник. У швидкій після 12 кіл ходів перемагає власник найбільшого капіталу. За рівності перевагу має попередній у порядку ходів.</p><p>На рішення є 40 секунд, у швидкій грі — 18. Після цього гра сама кидає кубики, відкриває або завершує аукціон.</p>');
$('#create').onclick=()=>modal(`<h2>Нова кімната</h2><form id="new">
  <fieldset><legend>Режим гри</legend>
    <label><input type="radio" name="mode" value="classic" checked><span>Класична<small>До перемоги одного гравця</small></span></label>
    <label><input type="radio" name="mode" value="quick"><span>Швидка<small>До 12 раундів</small></span></label>
  </fieldset>
  <fieldset><legend>Хто може приєднатися</legend>
    <label><input type="radio" name="access" value="public" checked><span>Усі гравці</span></label>
    <label><input type="radio" name="access" value="private"><span>Друзі за кодом</span></label>
  </fieldset><button class="primary">Створити кімнату</button></form>`,'Ігрові кімнати');
$('#join').onclick=()=>modal('<h2>Вхід за кодом</h2><form id="code"><label>Код кімнати<input name="code" maxlength="10" required autocomplete="off" autocapitalize="characters"></label><button class="primary">Приєднатися</button></form>');
function renderLobby(){
  if(!lobby)return;
  const rows=lobbyTab==='rooms'?lobby.rooms.map(r=>'<div class="row"><div><strong>'+esc(r.name)+'</strong><small>'+modeName(r.mode)+' · '+r.size+'/6 учасників</small></div><button data-join="'+esc(r.code)+'">Увійти</button></div>'):
    lobby.leaders.map(([name,n],i)=>'<div class="row"><strong>'+ (i+1)+'. '+esc(name)+'</strong><span>Перемог · '+n+'</span></div>');
  const html=rows.join('')||'<p class="empty">'+(lobbyTab==='rooms'?'Поки немає відкритих кімнат.':'Тут з’являться переможці завершених партій.')+'</p>';
  if(html!==listingMarkup){$('#listing').innerHTML=html;listingMarkup=html}
}
function renderFeed(){
  let html='';
  if(roomTab==='assets'){
    html=Object.entries(room.deeds).map(([i,d])=>'<div class="row"><div><strong>'+esc(board[i].name)+'</strong><small>'+esc(ownerName(d.owner))+' · Рівень '+d.level+'</small></div><button data-tile="'+i+'">Деталі</button></div>').join('');
  }else if(roomTab==='chat')html=room.chat.slice().reverse().map(m=>'<p class="line"><strong>'+esc(m.name)+'</strong> · '+esc(m.text)+'</p>').join('');
  else html=room.log.slice().reverse().map(m=>'<p class="line">'+esc(m)+'</p>').join('');
  html=html||'<p class="empty">'+({assets:'Усі ділянки ще вільні.',chat:'Повідомлень ще немає.',log:'Очікуємо на початок партії.'}[roomTab])+'</p>';
  if(html!==feedMarkup){$('#feed').innerHTML=html;feedMarkup=html}
  $('#chat-form').hidden=roomTab!=='chat';
}
function updateClock(){
  const timer=$('#status time');
  if(!timer||!room)return;
  const remaining=Math.max(0,Math.ceil(room.deadline-(Date.now()+offset)/1000));
  const text=remaining+' с';
  if(timer.textContent!==text)timer.textContent=text;
}
const playerCards=new Map();
function clearCards(){
  for(const {cash,delta,mark} of playerCards.values()){
    cancelMotion(cash);cancelMotion(delta);cancelMotion(mark);
  }
  playerCards.clear();$('#players').replaceChildren();
  turnId=resultKey=statusKey=actionKey=undefined;
}
function renderPlayers(p){
  const host=$('#players'), nextTurn=room.deadline?p.id:null;
  for(const [id,card] of playerCards)if(!room.players.some(q=>q.id===id)){
    [card.cash,card.delta,card.mark].forEach(cancelMotion);card.el.remove();playerCards.delete(id);
  }
  room.players.forEach((q,i)=>{
    let card=playerCards.get(q.id);
    if(!card){
      const el=document.createElement('div');el.className='player';
      el.innerHTML='<div class="avatar"></div><strong></strong><small></small><span class="delta" aria-hidden="true" hidden></span><i class="turn-mark" aria-hidden="true"></i>';
      const [avatar,name,cash,delta,mark]=el.children;
      card={el,avatar,name,cash,delta,mark,target:q.cash,shown:q.cash};
      cash.dataset.balance=q.id;playerCards.set(q.id,card);host.append(el);cash.textContent=money(q.cash);
    }
    const {el,avatar,name,cash,delta,mark}=card;
    el.style.setProperty('--seat',colors[i]);
    el.title=q.name+' · '+board[q.pos].name;
    const photo=typeof q.photo==='string'&&q.photo.startsWith('https://')?q.photo:'';
    if(card.photo!==photo||card.nameText!==q.name){
      if(photo){const img=new Image();img.src=photo;img.alt='';avatar.replaceChildren(img)}
      else avatar.textContent=q.name[0];
      name.textContent=q.name+(q.id===lobby.me?' · ви':'');card.photo=photo;card.nameText=q.name;
    }
    el.classList.toggle('active',nextTurn===q.id);el.classList.toggle('offline',q.out);
    el.classList.toggle('champion',room.winner===q.id);
    if(nextTurn===q.id && turnId!==undefined && turnId!==nextTurn)surface(mark,{scaleX:[.08,1]});
    if(q.out){
      cancelMotion(cash);cancelMotion(delta);delta.hidden=true;cash.textContent='Вибув(-ла)';
    }else if(card.target!==q.cash){
      const diff=q.cash-card.target;
      count(cash,card,q.cash,money);
      delta.classList.toggle('loss',diff<0);delta.textContent=(diff>0?'+':'')+money(diff);
      delta.hidden=still();
      if(!delta.hidden)surface(delta,{y:[3,0,0,-5],opacity:[.8,1,1,0]},
        {type:'tween',duration:1.12,times:[0,.16,.78,1]},()=>{delta.hidden=true});
    }
    card.target=q.cash;
  });
  if(nextTurn && turnId!==undefined && turnId!==nextTurn && mine())feedback.cue('turn');
  turnId=nextTurn;
}
function render(){
  if(rosterRoom!==room?.code){clearCards();rosterRoom=room?.code}
  const playing=!!room;$('#lobby').hidden=playing;$('#session').hidden=!playing;
  document.body.dataset.phase=room?.phase||'lobby';
  $('#subtitle').textContent=playing?'Кімната '+room.code:'Ігрові кімнати';
  const nextCaption=(room?.code||'')+'/'+(room?.roll||0);
  if(captionKey!==nextCaption){
    const label=$('#stage-label'), roll=room?.dice?.length;
    label.replaceChildren();
    if(roll){
      const caption=document.createElement('span');caption.className='dice-caption';caption.textContent='Кубики · ';
      label.append(caption);
      room.dice.forEach((value,i)=>{
        if(i)label.append(' + ');
        const face=document.createElement('b');face.className='die-value';face.textContent=value;label.append(face);
        if(fallback && lastOwners?.code===room.code && !still()){
          surface(face,{rotate:[i?15:-15,0],y:[-4,0]},{},i?undefined:()=>feedback.cue('impact'));
        }
      });
    }else label.textContent='20 клітинок';
    captionKey=nextCaption;
  }
  const visual=JSON.stringify([room?.code,room?.roll,room?.winner,room?.deeds,room?.players.map(p=>[p.id,p.pos,p.out])]);
  if(visual!==lastVisual){
    lastVisual=visual;
    const snapshot=room;
    queueMicrotask(()=>{
      if(disposed||!scene||lastVisual!==visual)return;
      try{scene.update(snapshot)}catch{useFlatBoard()}
    });
  }
  if(dialog.open && sheet.dataset.tile!==undefined && deedSignature!==deedState(sheet.dataset.tile)){
    detail(Number(sheet.dataset.tile));
  }
  renderTiles();
  if(!playing){$('#result').hidden=true;$('#activity').open=false;renderLobby();return}
  const p=active(), ph=room.phase;let buttons='', title='',caption='';
  $('#result').hidden=ph!=='finished';
  if(ph==='waiting'){title='Збір учасників';caption=room.players.length===1?'Запросіть ще одного гравця, щоб почати.':'Усі на місці? Ведучий може почати гру.';
    if(room.host===lobby.me)buttons+=btn('Почати гру','start',true,room.players.length<2);
    buttons+=btn('Код кімнати','code-card')+btn('Вийти','leave');}
  else if(ph==='finished'){
    title='Підсумки партії';caption=modeName(room.mode)+' · Ходів зіграно: '+room.moves;
    if(resultKey!==room.winner){
      const standings=room.players.map(q=>{
        const assets=Object.entries(room.deeds).filter(([,deed])=>deed.owner===q.id);
        const capital=assets.reduce((sum,[key,deed])=>sum+board[key].price+board[key].upgrade*deed.level,q.cash);
        return {q,capital};
      }).sort((a,b)=>Number(b.q.id===room.winner)-Number(a.q.id===room.winner)||b.capital-a.capital);
      const ranks=standings.map(({q,capital},i)=>'<div class="rank"><strong>'+(i+1)+'. '+esc(q.name)+'</strong><span>'+money(capital)+'</span></div>').join('');
      $('#result').innerHTML='<div class="winner"><small>Переможець</small><strong>'+esc(ownerName(room.winner))+'</strong></div><div class="standings">'+ranks+'</div>';
      if(turnId!==undefined){
        surface($('#result .winner'),{y:[12,0],scale:[.985,1]});
        $('#result').querySelectorAll('.rank').forEach((row,i)=>surface(row,{x:[9,0]},{delay:.035*Math.min(i+1,5)}));
        feedback.cue('win');
      }
      resultKey=room.winner;
    }
    buttons+=btn('До кімнат','leave',true)
  }
  else{
    title=mine()?'Ваш хід':'Ходить '+p.name;caption=board[p.pos].name;
    if(ph==='roll' && mine())buttons+=btn('Кинути кубики','roll',true);
    if(ph==='buy'){
      caption='Купівля · '+caption+' · '+money(board[p.pos].price);
      if(mine())buttons+=btn('Купити · '+money(board[p.pos].price),'buy',true,me().cash<board[p.pos].price)+btn('На аукціон','pass');
    }
    if(ph==='auction'){title='Аукціон · '+board[room.auction.tile].name;caption=room.auction.bidder?ownerName(room.auction.bidder)+' · '+money(room.auction.amount):'Початкова ставка · 10 ₴';
      if(!me().out)buttons+=btn('Підняти до '+money(room.auction.amount+10),'bid',true,me().cash<room.auction.amount+10)}
    if(room.offer){const o=room.offer;caption=ownerName(p.id)+' пропонує ділянку гравцеві '+ownerName(o.to)+'.';
      if(o.to===lobby.me)buttons+=btn('Придбати','accept',true,me().cash<o.amount)+btn('Відхилити','decline')}
    if(me().out)buttons+=btn('Вийти','leave');
    else buttons+=btn('Здатися','confirm-resign');
  }
  const statusState=JSON.stringify([!!room.deadline,title,caption,room.offer]);
  if(statusState!==statusKey){
    $('#status').innerHTML=(room.deadline?'<time></time>':'')+'<strong>'+esc(title)+'</strong><small>'+esc(caption)+'</small>';
    if(room.offer){
      const offer=room.offer;
      $('#status').insertAdjacentHTML('beforeend','<button class="trade-slip" data-tile="'+Number(offer.tile)+'"><span>'+esc(board[offer.tile].name)+'</span><b>'+money(offer.amount)+'</b></button>');
    }
    statusKey=statusState;
  }
  updateClock();
  if(buttons!==actionKey){$('#actions').innerHTML=buttons;actionKey=buttons}
  renderPlayers(p);
  renderFeed();
}
async function sync(){
  if(polling||busy||document.hidden)return;const generation=epoch;polling=true;
  try{
    if(room){const next=await api('rooms/'+room.code+'?v='+room.version);if(generation!==epoch)return;if(connectionFailed){connectionFailed=false;error()}if(!next)return;room=next;}
    else{const next=await api('lobby');if(generation!==epoch)return;lobby=next;board=lobby.board;$('main').hidden=false;$('#access-status').hidden=true;loadBoard();
      if(lobby.current){const resumed=await api('rooms/'+lobby.current);if(generation!==epoch)return;room=resumed}}
    if(generation===epoch){render();error()}
  }catch(e){if(generation===epoch){if($('main').hidden)$('#access-status').textContent=e.message;connectionFailed=true;if(e.status===404){room=null;render()}error(e.message)}}finally{polling=false}
}
async function send(action,values={},enter=false){
  if(busy)return;busy=true;epoch++;error();if(dialog.open){closingSheet=false;cancelMotion(dialog);dialog.close()}
  try{const next=await api(enter?'rooms':'rooms/'+room.code,{version:room?.version,action,...values});
    if(next.left)room=null;else room=next;
    render();if(enter||next.left)surface($(room?'#session':'#lobby'),{y:[8,0]});return true;
  }catch(e){error(e.message);return false}finally{busy=false;if(!room)void sync()}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tile!==undefined)detail(Number(b.dataset.tile));
  if(b.dataset.camera)scene?.camera(b.dataset.camera);
  if(b.dataset.join)send('join',{code:b.dataset.join},true);
  if(b.dataset.tab){const nav=b.closest('nav');nav.querySelector('.active')?.classList.remove('active');b.classList.add('active');
    if(nav.id==='room-tabs'){roomTab=b.dataset.tab;renderFeed()}else{lobbyTab=b.dataset.tab;renderLobby()}}
  if(b.dataset.act==='confirm-resign'){modal('<h2>Залишити партію?</h2><p>Ви втратите ділянки й вибудете з гри.</p>'+btn('Так, здатися','resign',true));return}
  if(b.dataset.act==='code-card'){modal('<h2>Код кімнати</h2><p>Друзі можуть ввести цей код у грі через кнопку «За кодом».</p><input id="invite" aria-label="Код кімнати" readonly value="'+esc(room.code)+'">');$('#invite').select();return}
  if(b.dataset.act){const a=b.dataset.act;send(a,a==='bid'?{amount:room.auction.amount+10}:a==='upgrade'?{tile:sheet.dataset.tile}:{})}
});
document.addEventListener('submit',async e=>{
  const f=e.target;if(!['new','code','offer','chat-form'].includes(f.id))return;
  e.preventDefault();const v=Object.fromEntries(new FormData(f));
  if(f.id==='new')await send('create',{mode:v.mode,private:v.access==='private'},true);
  if(f.id==='code')await send('join',{code:v.code},true);
  if(f.id==='offer')await send('offer',{tile:sheet.dataset.tile,to:v.to,amount:Number(v.amount)});
  if(f.id==='chat-form' && await send('chat',{text:f.querySelector('input').value}))f.reset();
});
function useFlatBoard(){
  if(fallback||disposed)return;
  fallback=true;
  scene?.dispose();scene=null;
  $('#camera').hidden=true;
  labelSize.disconnect();labels.remove();$('#stage canvas')?.remove();
  $('#stage').prepend(Object.assign(document.createElement('div'),{id:'flat',className:'fallback'}));
  render();
}
let loadingBoard=false;
function loadBoard(){
if(loadingBoard)return;loadingBoard=true;
import('./board.js').then(({city})=>{
  if(disposed)return;
  scene=city($('#stage'),detail,placeLabels,feedback.cue);
  $('#stage canvas').addEventListener('webglcontextlost',useFlatBoard,{once:true});
  scene.update(room);
}).catch(useFlatBoard);
}
const fullscreen=$('#fullscreen');
fullscreen.onclick=async()=>{
  try{
    if(tg?.isFullscreen)tg.exitFullscreen();
    else if(tg?.requestFullscreen && tg.isVersionAtLeast?.('8.0'))tg.requestFullscreen();
    else if(document.fullscreenElement)await document.exitFullscreen();
    else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
    else error('Повноекранний режим недоступний.');
  }catch{error('Повноекранний режим недоступний.')}
};
tg?.onEvent?.('fullscreenFailed',()=>error('Повноекранний режим недоступний.'));
let pollTimer, clockTimer, pollGeneration=0,disposed=false;
async function poll(){
  const generation=++pollGeneration;
  clearTimeout(pollTimer);
  if(document.hidden)return;
  await sync();
  if(!disposed&&!document.hidden&&generation===pollGeneration)pollTimer=setTimeout(poll,room?1500:4000);
}
function resume(){
  clearInterval(clockTimer);
  void poll();
  if(document.hidden)return;
  updateClock();
  clockTimer=setInterval(updateClock,400);
}
document.addEventListener('visibilitychange',resume);
window.addEventListener('online',poll);
window.addEventListener('pagehide',e=>{
  if(e.persisted)return;
  disposed=true;epoch++;pollGeneration++;clearTimeout(pollTimer);clearInterval(clockTimer);
  document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',poll);
  labelSize.disconnect();scene?.dispose();disposeUI();feedback.dispose();
});
resume();
