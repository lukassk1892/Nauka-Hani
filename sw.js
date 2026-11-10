/* Nauka Hani – praca offline i powiadomienia */
const VER='357f811d1c';
const CACHE='nauka-'+VER;
const SHELL=['./','index.html','clap.mp3','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.hostname.endsWith('supabase.co'))return;
  /* strona: najpierw sieć (świeża wersja), bez sieci – kopia */
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put('index.html',c));return r;}).catch(()=>caches.match('index.html')));return;}
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok&&(u.origin===location.origin||u.hostname.includes('jsdelivr')||u.hostname.includes('gstatic')||u.hostname.includes('googleapis'))){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));}return r;})));
});
self.addEventListener('push',e=>{
  let d={};try{d=e.data.json();}catch(_){d={title:'Nauka Hani',body:e.data?e.data.text():''};}
  e.waitUntil(self.registration.showNotification(d.title||'Nauka Hani',{body:d.body||'',icon:'icons/icon-192.png',badge:'icons/icon-192.png',tag:d.tag||'nauka',data:{url:d.url||'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus();}return self.clients.openWindow(e.notification.data.url||'./');}));
});
