/* Nauka Hani – konto, synchronizacja, monety i widok rodzica.
   Ładowany PO skrypcie aplikacji (app.html). Aplikacja startuje dopiero po zalogowaniu (NH_START). */
(function(){
'use strict';
const SB_URL='https://pzzfpqrlauljsxrbpnxd.supabase.co';
const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6emZwcXJsYXVsanN4cmJwbnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3ODY1MzAsImV4cCI6MjEwOTM2MjUzMH0.86XJXbfWUaGiDX9qqJSRW9WPmvTCtJRwyF4qwI_NQdw';
const FN_URL=SB_URL+'/functions/v1/notify';
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
window.NH_SB=sb;

/* ---------- localStorage: oryginalne metody i lista kluczy, których nie synchronizujemy ---------- */
const LS=window.localStorage;
const rawSet=Storage.prototype.setItem,rawRemove=Storage.prototype.removeItem;
const lsGet=k=>{try{return LS.getItem(k);}catch(e){return null;}};
const lsSet=(k,v)=>{try{rawSet.call(LS,k,v);}catch(e){}};
const jGet=(k,d)=>{try{const v=JSON.parse(lsGet(k));return v==null?d:v;}catch(e){return d;}};
const jSet=(k,v)=>lsSet(k,JSON.stringify(v));
const LOCAL_ONLY=k=>k.startsWith('nh-')||k.startsWith('sb-')||k==='pt-zoom';

let ME=null; /* {user_id, family_id, role, name} */
let syncOn=false,flushT=null,flushing=false;

/* ---------- ekran logowania ---------- */
function E(tag,attrs,...kids){return window.h(tag,attrs||{},...kids);}
const root=()=>document.getElementById('app');
function show(...kids){root().replaceChildren(...kids.filter(Boolean));window.scrollTo(0,0);}
function loginScreen(msg){
  const email=E('input',{type:'email',autocomplete:'username',placeholder:'twój e-mail',inputmode:'email'});
  const pass=E('input',{type:'password',autocomplete:'current-password',placeholder:'hasło'});
  const info=E('p',{class:'hint',role:'status'},msg||'');
  const go=E('button',{class:'check',type:'submit'},'Zaloguj');
  const form=E('form',{class:'typed nh-login',onsubmit:async ev=>{ev.preventDefault();go.disabled=true;info.textContent='Loguję…';
    const {error}=await sb.auth.signInWithPassword({email:email.value.trim(),password:pass.value});
    if(error){go.disabled=false;info.textContent=/invalid/i.test(error.message)?'Zły e-mail albo hasło. Spróbuj jeszcze raz.':'Nie udało się zalogować: '+error.message;return;}
    boot();}},email,pass,go,info);
  show(E('header',{class:'hero'},E('div',{class:'helix','aria-hidden':'true'},['A','G','C','T'].map((b,i)=>E('span',{style:`background:${BASES[b]};height:${[36,52,30,44][i]}px`}))),
      E('div',{},E('h1',{},'Nauka Hani'),E('p',{},'Zaloguj się raz – telefon zapamięta.'))),form,
    pendingImport()?E('p',{class:'nudge'},'📦 Po zalogowaniu przeniosę Twoje postępy ze starej aplikacji.'):null);
  setTimeout(()=>email.focus(),50);
}

/* ---------- przeniesienie postępów ze starej aplikacji (#import=...) ---------- */
function pendingImport(){return lsGet('nh-import');}
function grabImportFromHash(){const m=location.hash.match(/import=([^&]+)/);if(!m)return;lsSet('nh-import',m[1]);history.replaceState(null,'',location.pathname+location.search);}
async function decodeImport(s){
  const b64=s.replace(/-/g,'+').replace(/_/g,'/');const bin=atob(b64+'==='.slice((b64.length+3)%4));
  const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  const txt=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(txt);
}
async function applyImport(){
  const s=pendingImport();if(!s)return 0;
  let data;try{data=await decodeImport(s);}catch(e){console.warn('import',e);rawRemove.call(LS,'nh-import');return -1;}
  let n=0;for(const[k,v] of Object.entries(data||{})){if(typeof v!=='string'||LOCAL_ONLY(k))continue;
    const cur=lsGet(k);let val=v;
    if(cur!=null&&MERGE[k]){try{val=JSON.stringify(MERGE[k](JSON.parse(cur),JSON.parse(v)));}catch(e){}}
    lsSet(k,val);markDirty(k);n++;}
  rawRemove.call(LS,'nh-import');await flush();return n;
}

/* ---------- synchronizacja kluczy z tabelą kv ---------- */
function markDirty(k){const d=jGet('nh-dirty',{});d[k]=Date.now();jSet('nh-dirty',d);}
function hookStorage(){
  Storage.prototype.setItem=function(k,v){rawSet.call(this,k,v);if(this===LS&&syncOn&&!LOCAL_ONLY(String(k))){markDirty(String(k));schedule();}};
}
function schedule(ms){clearTimeout(flushT);flushT=setTimeout(flush,ms==null?2500:ms);}
async function flush(){
  if(!ME)return;if(flushing){schedule(3000);return;}const d=jGet('nh-dirty',{});const keys=Object.keys(d);
  flushing=true;
  try{
    if(keys.length){
      const rows=keys.map(k=>({user_id:ME.user_id,key:k,value:lsGet(k)??'',updated_at:new Date(d[k]).toISOString()}));
      const {error}=await sb.from('kv').upsert(rows);
      if(!error){const now=jGet('nh-dirty',{}),meta=jGet('nh-meta',{});keys.forEach(k=>{meta[k]=d[k];if(now[k]===d[k])delete now[k];});jSet('nh-dirty',now);jSet('nh-meta',meta);}
      else console.warn('kv',error.message);
    }
    if(ME.role==='child')await pushDay();
  }catch(e){console.warn('flush',e);}
  finally{flushing=false;}
  if(Object.keys(jGet('nh-dirty',{})).length)schedule(30000);
}
/* łączenie zmian z dwóch urządzeń dla kluczy, gdzie da się to zrobić bez strat */
const MERGE={
  'czas-nauki-v1':(a,b)=>{const by={};[...(b.s||[]),...(a.s||[])].forEach(x=>{const o=by[x.id];if(!o||(x.en||0)>=(o.en||0))by[x.id]=x;});
    return Object.assign({},b,a,{s:Object.values(by).sort((x,y)=>x.st-y.st)});},
  'gry-v1':(a,b)=>{const ch={};[b.ch||{},a.ch||{}].forEach(o=>Object.entries(o).forEach(([k,n])=>ch[k]=Math.max(ch[k]||0,n)));
    return Object.assign({},b,a,{ch,chestCoins:Math.max(a.chestCoins||0,b.chestCoins||0),beaten:Math.max(a.beaten||0,b.beaten||0),
      jok:[...new Set([...(b.jok||[]),...(a.jok||[])])],cheers:[...new Set([...(b.cheers||[]),...(a.cheers||[])])].slice(-100),d:Object.assign({},b.d,a.d)});}
};
async function pull(){
  const {data,error}=await sb.from('kv').select('key,value,updated_at').eq('user_id',ME.user_id);
  if(error)throw error;
  const dirty=jGet('nh-dirty',{}),meta=jGet('nh-meta',{});
  for(const r of data){const rt=Date.parse(r.updated_at);
    if(meta[r.key]>=rt)continue;                       /* tę wersję już mamy */
    const local=lsGet(r.key),m=MERGE[r.key];
    if(dirty[r.key]&&local!=null&&m){                  /* zmiany na dwóch urządzeniach – połącz */
      try{lsSet(r.key,JSON.stringify(m(JSON.parse(local),JSON.parse(r.value))));}catch(e){}
      meta[r.key]=rt;markDirty(r.key);continue;}
    if(dirty[r.key]&&dirty[r.key]>rt)continue;          /* lokalna zmiana nowsza – zostanie wysłana */
    lsSet(r.key,r.value);meta[r.key]=rt;
    if(dirty[r.key]){const d=jGet('nh-dirty',{});delete d[r.key];jSet('nh-dirty',d);}}
  jSet('nh-meta',meta);
  /* klucze, których nie ma na serwerze (np. postępy sprzed konta) – wyślij */
  const have=new Set(data.map(r=>r.key));
  for(let i=0;i<LS.length;i++){const k=LS.key(i);if(k&&!LOCAL_ONLY(k)&&!have.has(k)&&!dirty[k])markDirty(k);}
}

/* ---------- dzień (szybki odczyt dla taty i powiadomień) ---------- */
function rawDayMs(){const by={};window.tLoad().s.filter(x=>x.act>=5000||x.ans>0).forEach(x=>{by[x.d]=(by[x.d]||0)+x.act;});return by;}
async function pushDay(){
  const k=dayKey(Date.now()),list=window.tLoad().s.filter(x=>x.d===k&&(x.act>=5000||x.ans>0));
  const subj={};list.forEach(x=>{const n=subjName(x.subj);subj[n]=(subj[n]||0)+Math.round(x.act/60000);});
  const c=coins(),overdue=planOverdue();
  const row={user_id:ME.user_id,day:k,overdue,active_min:Math.floor(list.reduce((s,x)=>s+x.act,0)/60000),coins:c.balance,rounds:list.filter(x=>x.fin).length,subjects:subj,updated_at:new Date().toISOString()};
  const sig=JSON.stringify([row.day,row.active_min,row.coins,row.rounds,row.subjects,row.overdue]);
  if(sig===lsGet('nh-daysig'))return;
  const {error}=await sb.from('days').upsert(row);if(!error)lsSet('nh-daysig',sig);
}

/* zaległe punkty planów do sprawdzianów (dla taty i raportu) */
function planOverdue(){const out=[];try{Object.keys(SUBJECTS).forEach(id=>{const P=window.planStatus&&window.planStatus(id);if(P)P.over.forEach(x=>out.push({s:SUBJECTS[id].subject,d:x.d,t:x.txt}));});}catch(e){}return out;}
/* ---------- dane rodziny (nagrody, zgłoszenia, wydarzenia) – kopia w nh-fam ---------- */
async function loadFamily(){
  const [rw,cl,ev,fm,mb]=await Promise.all([
    sb.from('rewards').select('*').order('price'),
    sb.from('claims').select('*').order('created_at',{ascending:false}),
    sb.from('events').select('*').order('created_at',{ascending:false}).limit(200),
    sb.from('families').select('*').single(),
    sb.from('members').select('*')]);
  const fam={rewards:rw.data||[],claims:cl.data||[],events:ev.data||[],family:fm.data||null,members:mb.data||[],at:Date.now()};
  if(!rw.error)jSet('nh-fam',fam);
  return jGet('nh-fam',fam);
}
const FAM=()=>jGet('nh-fam',{rewards:[],claims:[],events:[],family:null,members:[]});

/* ---------- monety ---------- */
const G_KEY='gry-v1',COIN_START='2026-11-04',START_BONUS=200;
const gLoad=()=>Object.assign({d:{},ch:{},chestCoins:0,wk:null,beaten:0,jok:[],seen:0,cheers:[]},jGet(G_KEY,{}));
const gSave=g=>{try{LS.setItem(G_KEY,JSON.stringify(g));}catch(e){}}; /* przez hook → też na serwer */
const weekStart=k=>{const[y,m,d]=k.split('-').map(Number);const dt=new Date(y,m-1,d,12);dt.setDate(dt.getDate()-((dt.getDay()+6)%7));return dayKey(dt.getTime());};
function updateG(){
  const g=gLoad();let ch=false;
  const by={};window.tLoad().s.filter(x=>x.act>=5000||x.ans>0).forEach(x=>{const o=by[x.d]=by[x.d]||{work:0,act:0,ex:{}};o.work+=(x.work!=null?x.work:x.act);o.act+=x.act;
    if(x.kind==='exam'&&x.fin&&x.pct>=80)o.ex[x.subj]=1;});
  for(const[k,o] of Object.entries(by)){const hit=o.act>=GOAL_MS?1:0;const c=Math.floor(o.work/60000)+(hit?15:0)+Object.keys(o.ex).length*20;
    const old=g.d[k];if(!old||old.c!==c||old.h!==hit){g.d[k]={c,h:hit};ch=true;}}
  /* słabe punkty pokonane: było słabe, już nie jest */
  const wk={};for(const id of Object.keys(SUBJECTS)){const S=SUBJECTS[id],st=window.loadStore(S.key);wk[S.key]=Object.keys(st.k||{}).filter(c=>st.k[c]&&st.k[c].weak);}
  if(g.wk){for(const key of Object.keys(wk)){const was=g.wk[key]||[];was.forEach(c=>{if(!wk[key].includes(c))g.beaten++;});}}
  if(JSON.stringify(g.wk)!==JSON.stringify(wk)){g.wk=wk;ch=true;}
  if(ch)gSave(g);
  return g;
}
function coins(){
  const g=gLoad(),f=FAM();
  /* monety liczone od startu konta (decyzja taty 4.11.2026: 200 monet na start, wcześniejsza nauka bez monet) */
  const days=Object.entries(g.d).filter(([k])=>k>=COIN_START).reduce((s,[,o])=>s+o.c,0);
  const weeks={};Object.entries(g.d).forEach(([k,o])=>{if(o.h&&k>=COIN_START){const w=weekStart(k);weeks[w]=(weeks[w]||0)+1;}});
  const cups=Object.values(weeks).filter(n=>n>=WEEK_GOAL).length;
  const bonus=f.events.filter(e=>e.kind==='bonus').reduce((s,e)=>s+(e.amount||0),0);
  const earned=START_BONUS+days+cups*50+g.beaten*5+g.chestCoins+bonus;
  const spent=f.claims.filter(c=>c.status!=='declined').reduce((s,c)=>s+c.price,0);
  return {earned,spent,balance:earned-spent,cups,level:1+Math.floor(earned/200),toNext:200-earned%200,beaten:g.beaten};
}
function badges(){
  const g=gLoad(),c=coins(),gi=window.gInfo(),hits=Object.values(g.d).filter(o=>o.h).length;
  const exam=window.tLoad().s.some(x=>x.kind==='exam'&&x.fin&&x.pct>=80);
  let best=0,run=0;Object.keys(g.d).sort().forEach((k,i,a)=>{const prev=i?a[i-1]:null;const cont=prev&&(Date.parse(k)-Date.parse(prev)<=864e5*1.5);run=g.d[k].h?(cont&&run?run+1:1):0;best=Math.max(best,run);});
  best=Math.max(best,gi.streak);
  return [['🌱','Pierwsze 60 minut',hits>=1],['🔥','Seria 3 dni',best>=3],['⚡','Seria 7 dni',best>=7],['🏆','Puchar tygodnia',c.cups>=1],
    ['🎯','Sprawdzian próbny ≥ 80%',exam],['💪','5 słabych punktów pokonanych',g.beaten>=5],['🎁','10 skrzynek',Object.values(g.ch).reduce((s,n)=>s+n,0)>=10],['⭐','Poziom 5',c.level>=5]];
}
/* jokery i dni wolne od taty liczą się do serii (ale nie dają monet za cel) */
function protectedDays(){const g=gLoad(),f=FAM();return new Set([...g.jok,...f.events.filter(e=>e.kind==='dayoff'&&e.day).map(e=>e.day)]);}
function patchStreak(){
  const orig=window.gByDay;
  window.gByDay=function(){const by=orig();protectedDays().forEach(k=>{by[k]=Math.max(by[k]||0,GOAL_MS);});return by;};
}
function jokerOffer(){
  const g=gLoad(),y=dayKey(Date.now()-864e5),y2=dayKey(Date.now()-2*864e5),by=window.gByDay();
  const wk=weekStart(dayKey(Date.now()));
  if((by[y]||0)>=GOAL_MS)return null;if(!((by[y2]||0)>=GOAL_MS))return null;
  if(g.jok.some(k=>weekStart(k)===wk))return null;
  return y;
}

/* ---------- dodatki na ekranie głównym Hani ---------- */
let lastCoins=null;
function decorateHub(){
  const a=root(),goal=a.querySelector('.goal');if(!goal)return;
  updateG();const c=coins(),g=gLoad(),f=FAM(),today=dayKey(Date.now());
  const act=rawDayMs()[today]||0,chestAvail=Math.max(0,Math.floor(act/(20*60000))-(g.ch[today]||0));
  const delta=g.seen&&c.earned>g.seen?c.earned-g.seen:0;
  const box=E('section',{class:'nh-coins'},
    E('button',{class:'nh-coinbtn',type:'button',onclick:shop},
      E('span',{class:'nh-coin','aria-hidden':'true'},'🪙'),
      E('span',{},E('b',{},String(c.balance)),E('small',{},' monet')),
      delta?E('span',{class:'nh-delta'},'+'+delta):null,
      E('span',{class:'nh-lvl'},'Poziom '+c.level)),
    chestAvail?E('button',{class:'nh-chest',type:'button',onclick:()=>openChest(today)},'🎁 Otwórz skrzynkę'+(chestAvail>1?' ('+chestAvail+')':'')):
      E('span',{class:'nh-next'},'🎁 Skrzynka co 20 min nauki · następna za '+Math.max(1,20-Math.floor(act/60000)%20)+' min'));
  goal.after(box);
  if(g.seen!==c.earned){g.seen=c.earned;gSave(g);}
  /* „Brawo” od taty – pokaż nowe */
  const fresh=f.events.filter(e=>e.kind==='cheer'&&!g.cheers.includes(e.id)&&Date.now()-Date.parse(e.created_at)<3*864e5);
  if(fresh.length){const e=fresh[0];box.after(E('div',{class:'nh-cheer'},E('b',{},'👏 Tata: '),e.message||'Brawo!',
    E('button',{class:'fixbtn',type:'button',onclick:ev=>{const gg=gLoad();gg.cheers=[...gg.cheers,...fresh.map(x=>x.id)].slice(-100);gSave(gg);ev.target.parentNode.remove();}},'Dzięki!')));}
  const dayoff=f.events.find(e=>e.kind==='dayoff'&&e.day===today);
  if(dayoff)box.after(E('div',{class:'nh-cheer'},'🌴 Dziś masz dzień wolny od taty – seria jest bezpieczna.'));
  const jk=jokerOffer();
  if(jk)box.after(E('div',{class:'nh-cheer'},'🃏 Wczoraj zabrakło minut. Masz jokera na ten tydzień – uratuje serię.',
    E('button',{class:'fixbtn',type:'button',onclick:()=>{const gg=gLoad();gg.jok.push(jk);gSave(gg);window.hub();}},'Użyj jokera')));
  const pend=f.claims.filter(x=>x.status==='approved');
  if(pend.length)box.after(E('div',{class:'nh-cheer'},'✅ Tata zatwierdził: '+pend.map(x=>rewardName(x.reward_id)).join(', ')+'. Upomnij się o nagrodę!'));
  /* przypomnienia i instalacja */
  const extra=pushButton();if(extra)a.querySelector('.subjs').before(extra);
  const foot=a.querySelector('.foot');if(foot)foot.textContent='Postępy zapisują się na Twoim koncie – nic nie zginie.';
  const out=E('button',{class:'reset',type:'button',onclick:logout},'Wyloguj ('+(ME.name||'')+')');a.append(out);
}
const rewardName=id=>{const r=FAM().rewards.find(x=>x.id===id);return r?r.title:'nagroda';};
function openChest(day){
  const g=gLoad(),v=3+Math.floor(Math.random()*8);g.ch[day]=(g.ch[day]||0)+1;g.chestCoins+=v;gSave(g);
  const x=window.btn('x','×',window.hub);x.setAttribute('aria-label','Wróć');
  show(E('div',{class:'result'},E('div',{class:'nh-big'},'🎁'),E('h2',{},'+'+v+' monet!'),E('p',{},'Następna skrzynka po kolejnych 20 minutach nauki.'),
    E('div',{class:'btns'},window.btn('next','Super!',window.hub))));
  window.confetti();schedule(500);
}

/* ---------- skarbonka: nagrody od taty ---------- */
async function shop(){
  const back=window.btn('x','×',window.hub);back.setAttribute('aria-label','Wróć');
  const render=()=>{
    const f=FAM(),c=coins(),b=badges();
    const active=f.rewards.filter(r=>r.active);
    const mine=f.rewards.filter(r=>r.proposed_by_child&&!r.active);
    const claims=f.claims.slice(0,8);
    const title=E('input',{placeholder:'np. wyjście do kina',maxlength:'60'}),price=E('input',{type:'number',min:'10',step:'10',placeholder:'ile monet?',inputmode:'numeric'});
    show(E('div',{},
      E('div',{class:'top'},back,E('span',{class:'label'},'Skarbonka'),E('span')),
      E('section',{class:'tcard'},E('span',{class:'label'},'Masz'),E('b',{},'🪙 '+c.balance),E('small',{},'Poziom '+c.level+' · do następnego '+c.toNext+' monet · zebrane razem: '+c.earned)),
      E('span',{class:'label'},'Nagrody od taty'),
      E('div',{class:'list'},active.length?active.map(r=>{const can=c.balance>=r.price;
        return E('div',{class:'opt nh-rw'},E('span',{},E('b',{},r.title),E('br'),E('small',{class:'nh-price'},'🪙 '+r.price)),
          can?window.btn('fixbtn nh-buy','Wymień',async ev=>{ev.target.disabled=true;const {error}=await sb.from('claims').insert({reward_id:r.id,child_id:ME.user_id,price:r.price});
            if(error){ev.target.textContent='Błąd';return;}await loadFamily();render();window.confetti();}):E('small',{},'brakuje '+(r.price-c.balance)));}):
        E('p',{class:'hint'},'Tata jeszcze nie dodał nagród. Zaproponuj swoją poniżej!')),
      claims.length?E('div',{},E('span',{class:'label'},'Moje wymiany'),E('div',{class:'list'},claims.map(x=>E('div',{class:'trow'},
        E('span',{class:'tm'},new Date(x.created_at).toLocaleDateString('pl-PL',{day:'2-digit',month:'2-digit'})),E('span',{class:'tn'},rewardName(x.reward_id)),
        E('span',{class:'td'},{pending:'⏳ czeka',approved:'✅ zatwierdzona',given:'🎉 odebrana',declined:'✖ odrzucona'}[x.status]))))):null,
      E('span',{class:'label'},'Zaproponuj nagrodę'),
      E('div',{class:'typed'},title,price,window.btn('check','Wyślij tacie',async ev=>{const t=title.value.trim(),p=parseInt(price.value,10);if(!t||!(p>0))return;ev.target.disabled=true;
        const {error}=await sb.from('rewards').insert({family_id:ME.family_id,title:t,price:p,proposed_by_child:true,active:false});
        if(!error){await loadFamily();render();}else ev.target.textContent='Nie udało się';})),
      mine.length?E('p',{class:'hint'},'Czekają na tatę: '+mine.map(r=>r.title+' ('+r.price+')').join(', ')):null,
      E('span',{class:'label',style:'display:block;margin-top:16px'},'Odznaki'),
      E('div',{class:'nh-badges'},b.map(([i,n,ok])=>E('div',{class:'nh-badge'+(ok?' on':'')},E('span',{},i),E('small',{},n)))),
      E('p',{class:'hint',style:'margin-top:12px'},'Jak zdobywać monety: 1 za każdą minutę rozwiązywania · +15 za 60 minut dziennie · +20 za sprawdzian próbny ≥ 80% · +5 za pokonany słaby punkt · +50 za puchar tygodnia · skrzynka co 20 minut.')));
  };
  render();loadFamily().then(render).catch(()=>{});
}

/* ---------- powiadomienia push ---------- */
async function vapidKey(){let k=lsGet('nh-vapid');if(k)return k;const r=await fetch(FN_URL+'?vapid=1');const j=await r.json();k=j.publicKey;if(k)lsSet('nh-vapid',k);return k;}
const b64u=s=>{const p='='.repeat((4-s.length%4)%4),b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0));};
async function subscribePush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('Ta przeglądarka nie obsługuje powiadomień.');
  const perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('Powiadomienia są zablokowane w ustawieniach telefonu.');
  const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64u(await vapidKey())});
  const j=sub.toJSON();const {error}=await sb.from('push_subs').upsert({endpoint:j.endpoint,user_id:ME.user_id,sub:j});if(error)throw error;
  lsSet('nh-push',j.endpoint);
}
function pushButton(){
  if(!('Notification' in window)||!('serviceWorker' in navigator))return null;
  if(Notification.permission==='granted'&&lsGet('nh-push')){navigator.serviceWorker.ready.then(r=>r.pushManager.getSubscription()).then(s=>{if(!s)rawRemove.call(LS,'nh-push');});return null;}
  const b=E('button',{class:'tool nh-push',type:'button'},E('span',{class:'label'},'Powiadomienia'),E('h3',{},'🔔 Włącz przypomnienia'),
    E('span',{},ME.role==='child'?'Przypomnę o nauce tylko wtedy, gdy brakuje minut. Nic po 20:00.':'Dostaniesz wiadomość, gdy Hania zrobi 60 minut, i raport wieczorem.'));
  b.onclick=async()=>{b.disabled=true;try{await subscribePush();b.replaceWith(E('p',{class:'nudge'},'🔔 Przypomnienia włączone.'));}catch(e){b.disabled=false;b.querySelector('span:last-child').textContent=e.message||String(e);}};
  return b;
}

/* ---------- widok rodzica ---------- */
let parentCh=null;
async function parentHome(){
  const f=await loadFamily().catch(()=>FAM());
  const kid=f.members.find(m=>m.role==='child');
  if(!kid){show(E('div',{},E('h2',{class:'q'},'Cześć '+(ME.name||'')+'!'),E('p',{class:'hint'},'Hania jeszcze się nie zalogowała. Gdy zaloguje się pierwszy raz, zobaczysz tu jej naukę.'),pushButton(),
    window.btn('ghost','Odśwież',parentHome),E('button',{class:'reset',type:'button',onclick:logout},'Wyloguj')));return;}
  /* kopia postępów Hani tylko do podglądu (bez synchronizacji) */
  const kv=await sb.from('kv').select('key,value').eq('user_id',kid.user_id);
  (kv.data||[]).forEach(r=>{if(!LOCAL_ONLY(r.key))lsSet(r.key,r.value);});
  const since=dayKey(Date.now()-13*864e5);
  const dq=await sb.from('days').select('*').eq('user_id',kid.user_id).gte('day',since);
  const days={};(dq.data||[]).forEach(d=>days[d.day]=d);
  renderParent(kid,days);
  if(!parentCh){parentCh=sb.channel('rodzic').on('postgres_changes',{event:'*',schema:'public',table:'days',filter:'user_id=eq.'+kid.user_id},p=>{if(p.new&&p.new.day){days[p.new.day]=p.new;if(document.querySelector('.nh-parent'))renderParent(kid,days,true);}})
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'claims'},()=>parentHome()).on('postgres_changes',{event:'INSERT',schema:'public',table:'rewards'},()=>parentHome()).subscribe();}
}
function renderParent(kid,days,live){
  const f=FAM(),today=dayKey(Date.now()),t=Object.assign({active_min:0,coins:0,rounds:0,subjects:{}},days[today]||{});
  let td=[];try{td=window.tDays(7);}catch(e){}
  const locMin=k=>{const d=td.find(x=>x.k===k);return d?Math.floor(d.ms/60000):0;};
  t.active_min=Math.max(t.active_min,locMin(today));
  const goal=(f.family&&f.family.goal_min)||60;
  const wk=[];for(let i=6;i>=0;i--){const k=dayKey(Date.now()-i*864e5);wk.push({k,m:Math.max((days[k]||{}).active_min||0,locMin(k))});}
  const max=Math.max(goal,...wk.map(d=>d.m));
  let D=null;try{D=window.pData();}catch(e){}
  const gi=(()=>{try{return window.gInfo();}catch(e){return null;}})();
  const hard=D?D.subs.flatMap(x=>x.hard.map(hh=>({...hh,sub:x.S.subject}))).sort((a,b)=>(b.weak-a.weak)||(b.bad-a.bad)).slice(0,6):[];
  const pending=f.claims.filter(c=>c.status==='pending'),approved=f.claims.filter(c=>c.status==='approved');
  const props=f.rewards.filter(r=>r.proposed_by_child&&!r.active),active=f.rewards.filter(r=>r.active);
  const subjTxt=Object.entries(t.subjects||{}).filter(([,m])=>m>0).map(([n,m])=>n+' '+m+' min').join(' · ');
  const act=(fn)=>async ev=>{ev.target.disabled=true;try{await fn();}catch(e){alertBox(e.message||String(e));}await loadFamily();renderParent(kid,days);};
  const nt=E('input',{placeholder:'nowa nagroda, np. kino z tatą',maxlength:'60'}),np=E('input',{type:'number',min:'10',step:'10',placeholder:'cena w monetach',inputmode:'numeric'});
  const times=E('input',{value:((f.family&&f.family.remind_times)||[]).join(', '),placeholder:'16:00, 17:30, 19:00'});
  const rep=E('input',{value:(f.family&&f.family.report_time)||'21:00',placeholder:'21:00'});
  show(E('div',{class:'nh-parent'},
    E('header',{class:'hero'},E('div',{},E('h1',{},'Hania dziś'),E('p',{},live?'aktualizuje się na żywo · '+new Date().toTimeString().slice(0,5):'widok rodzica · '+(ME.name||'')))),
    E('section',{class:'goal'+(t.active_min>=goal?' done':'')},
      E('div',{class:'goal-top'},E('span',{class:'label'},'Minuty dziś'),E('span',{class:'goal-fire'},gi&&gi.streak?'🔥 seria '+gi.streak+' '+dniTxt(gi.streak):'')),
      E('div',{class:'goal-num'},String(t.active_min),E('small',{},' / '+goal+' min')),
      E('div',{class:'bar'},E('i',{style:`width:${Math.min(100,Math.round(t.active_min/goal*100))}%;background:${t.active_min>=goal?'var(--t)':'var(--warn)'}`})),
      E('p',{class:'goal-msg'},(t.rounds?t.rounds+' rund · ':'')+(subjTxt||'dziś jeszcze bez nauki')+' · 🪙 '+t.coins)),
    E('section',{class:'tcard'},E('span',{class:'label'},'Ostatnie 7 dni'),
      E('div',{class:'week'},wk.map(d=>E('div',{class:'wk'+(d.k===today?' today':'')},E('span',{},d.m?String(d.m):''),
        E('div',{class:'col2'},E('i',{style:`height:${Math.round(d.m/max*100)}%;background:${d.m>=goal?'var(--t)':'var(--warn)'}`})),
        E('span',{},['Nd','Pn','Wt','Śr','Cz','Pt','Sb'][new Date(d.k+'T12:00').getDay()])))),
      E('small',{},'Razem '+wk.reduce((s,d)=>s+d.m,0)+' min · cel '+goal+' min dziennie'+(gi?' · ten tydzień '+gi.wHit+'/7 dni':''))),
    pending.length||approved.length?E('section',{class:'plan'},E('h3',{},'🎁 Nagrody do decyzji'),
      ...pending.map(c=>E('div',{class:'nh-row'},E('span',{},rewardName(c.reward_id)+' · 🪙 '+c.price),
        window.btn('fixbtn','Zatwierdź',act(async()=>{const {error}=await sb.from('claims').update({status:'approved',decided_at:new Date().toISOString()}).eq('id',c.id);if(error)throw error;})),
        window.btn('fixbtn','Odrzuć',act(async()=>{const {error}=await sb.from('claims').update({status:'declined',decided_at:new Date().toISOString()}).eq('id',c.id);if(error)throw error;})))),
      ...approved.map(c=>E('div',{class:'nh-row'},E('span',{},'✅ '+rewardName(c.reward_id)+' – do wręczenia'),
        window.btn('fixbtn','Wręczone',act(async()=>{const {error}=await sb.from('claims').update({status:'given'}).eq('id',c.id);if(error)throw error;}))))):null,
    E('section',{class:'plan'},E('h3',{},'👏 Dla Hani'),
      E('div',{class:'nh-btns'},
        ...['Brawo! 👏','Jestem z Ciebie dumny 💛','Super seria! 🔥'].map(m=>window.btn('fixbtn',m,act(async()=>{const {error}=await sb.from('events').insert({family_id:ME.family_id,author:ME.user_id,kind:'cheer',message:m});if(error)throw error;alertBox('Wysłane: '+m);}))),
        ...[10,20,50].map(a=>window.btn('fixbtn','+'+a+' 🪙',act(async()=>{const {error}=await sb.from('events').insert({family_id:ME.family_id,author:ME.user_id,kind:'bonus',amount:a,message:'Bonus od taty'});if(error)throw error;alertBox('Dodano '+a+' monet.');}))),
        window.btn('fixbtn','🌴 Dzień wolny dziś',act(async()=>{const {error}=await sb.from('events').insert({family_id:ME.family_id,author:ME.user_id,kind:'dayoff',day:today,message:'Dzień wolny'});if(error)throw error;alertBox('Dziś bez przypomnień, seria bezpieczna.');})))),
    (()=>{const ov=planOverdue();return ov.length?E('section',{class:'weak'},E('h3',{},'⏳ Zaległe w planie ('+ov.length+')'),
      E('p',{},'Te punkty planu przechodzą na kolejne dni – Hania widzi je na górze planu jako „do nadrobienia”.'),
      E('div',{class:'wchips'},ov.map(x=>E('span',{class:'wchip'},x.s+': '+x.t.replace(/\s*\(.*\)$/,'')+' ('+x.d.slice(8)+'.'+x.d.slice(5,7)+')')))):null;})(),
    hard.length?E('section',{class:'weak'},E('h3',{},'⚠️ Z czym ma kłopot'),E('div',{class:'wchips'},hard.map(x=>E('span',{class:'wchip'},x.sub+': '+x.name)))):null,
    D?E('section',{class:'tcard'},E('span',{class:'label'},'Przedmioty'),...D.subs.map(x=>E('small',{},x.S.subject+': '+x.done+'/'+x.total+' opanowanych'+(x.exam?' · próbny: rekord '+x.exam+'%':'')))):null,
    E('section',{class:'plan'},E('h3',{},'🪙 Nagrody w skarbonce'),
      ...active.map(r=>E('div',{class:'nh-row'},E('span',{},r.title+' · 🪙 '+r.price),window.btn('fixbtn','Usuń',act(async()=>{const {error}=await sb.from('rewards').update({active:false,proposed_by_child:false}).eq('id',r.id);if(error)throw error;})))),
      ...props.map(r=>E('div',{class:'nh-row'},E('span',{},'💡 Hania proponuje: '+r.title+' · 🪙 '+r.price),
        window.btn('fixbtn','Dodaj',act(async()=>{const {error}=await sb.from('rewards').update({active:true}).eq('id',r.id);if(error)throw error;})),
        window.btn('fixbtn','Nie',act(async()=>{const {error}=await sb.from('rewards').delete().eq('id',r.id);if(error)throw error;})))),
      E('div',{class:'typed'},nt,np,window.btn('check','Dodaj nagrodę',act(async()=>{const tt=nt.value.trim(),p=parseInt(np.value,10);if(!tt||!(p>0))throw new Error('Wpisz nazwę i cenę.');
        const {error}=await sb.from('rewards').insert({family_id:ME.family_id,title:tt,price:p});if(error)throw error;}))),
      E('small',{class:'hint'},'Podpowiedź: 1 moneta to ok. 1 minuta nauki. Np. 100 – mała przyjemność, 200 – wieczór filmowy, 400 – wyjście, 1500 – duża nagroda.')),
    pushButton(),
    E('details',{class:'eps'},E('summary',{},'⚙️ Godziny przypomnień'),
      E('div',{class:'typed',style:'margin-top:8px'},E('small',{},'Przypomnienia dla Hani (tylko gdy brakuje minut):'),times,E('small',{},'Twój raport wieczorny:'),rep,
        window.btn('check','Zapisz',act(async()=>{const tm=times.value.split(/[ ,;]+/).filter(Boolean);if(!tm.every(x=>/^\d{1,2}:\d{2}$/.test(x))||!/^\d{1,2}:\d{2}$/.test(rep.value.trim()))throw new Error('Wpisz godziny jak 16:00.');
          const {error}=await sb.from('families').update({remind_times:tm.map(x=>x.padStart(5,'0')),report_time:rep.value.trim().padStart(5,'0')}).eq('id',ME.family_id);if(error)throw error;alertBox('Zapisane.');})))),
    window.btn('ghost','Odśwież',parentHome),
    E('button',{class:'reset',type:'button',onclick:logout},'Wyloguj')));
}
function alertBox(msg){const n=E('div',{class:'nh-toast',role:'status'},msg);document.body.append(n);setTimeout(()=>n.remove(),2600);}

/* ---------- start ---------- */
async function logout(){await sb.auth.signOut();['nh-dirty','nh-meta','nh-fam','nh-push','nh-daysig','nh-me'].forEach(k=>rawRemove.call(LS,k));location.reload();}
async function getMember(){
  const {data,error}=await sb.rpc('claim_invite');
  if(error){if(/zaproszenia/.test(error.message))throw new Error('noinvite');throw error;}
  const {data:{user}}=await sb.auth.getUser();
  return {user_id:data.user_id,family_id:data.family_id,role:data.role,name:data.name,email:user&&user.email};
}
let started=false;
async function boot(){
  grabImportFromHash();
  const {data:{session}}=await sb.auth.getSession();
  if(!session){loginScreen();return;}
  try{ME=await getMember();jSet('nh-me',ME);}
  catch(e){
    if(e.message==='noinvite'){await sb.auth.signOut();loginScreen('Ten adres nie ma dostępu. Poproś tatę, żeby go dodał.');return;}
    ME=jGet('nh-me',null);/* offline – działaj na tym, co jest w telefonie */
    if(!ME||ME.user_id!==session.user.id){loginScreen('Brak internetu. Połącz się i spróbuj ponownie.');return;}
  }
  if(ME.role==='parent'){document.documentElement.classList.add('nh-par');parentHome();
    /* widok taty: odśwież minuty po powrocie do aplikacji i co minutę (gdy połączenie na żywo się zerwie) */
    const parentRefresh=()=>{if(!document.hidden&&document.querySelector('.nh-parent'))parentHome().catch(()=>{});};
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)parentRefresh();});
    setInterval(parentRefresh,60000);return;}
  /* dziecko */
  show(E('p',{class:'hint',style:'text-align:center;margin-top:40vh'},'Wczytuję postępy…'));
  try{await pull();}catch(e){console.warn('pull',e);}
  syncOn=true;
  const imp=await applyImport();
  try{await loadFamily();}catch(e){}
  patchStreak();
  const origHub=window.hub;
  window.hub=function(){origHub.apply(this,arguments);try{decorateHub();}catch(e){console.warn(e);}schedule();};
  if(!started){started=true;window.hub();}
  if(imp>0)alertBox('📦 Przeniesiono postępy ze starej aplikacji ('+imp+').');
  if(imp<0)alertBox('Nie udało się przenieść postępów – spróbuj jeszcze raz z przycisku w starej aplikacji.');
  schedule(1000);
  addEventListener('online',()=>schedule(500));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();else{loadFamily().catch(()=>{});schedule(500);}});
  sb.channel('rodzina').on('postgres_changes',{event:'*',schema:'public',table:'events'},()=>loadFamily().catch(()=>{}))
    .on('postgres_changes',{event:'*',schema:'public',table:'claims'},()=>loadFamily().catch(()=>{})).subscribe();
}
hookStorage();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
window.NH={boot,coins,flush,pull};
boot();
})();
