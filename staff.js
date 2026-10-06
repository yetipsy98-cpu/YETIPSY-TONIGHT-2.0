const app=document.getElementById('app'),API=YT_API;
let S=JSON.parse(localStorage.getItem('yt_open_staff')||'{}');
let pollTimer=null,pollBusy=false,qrRefreshTimeout=null,qrCountdownTimer=null,current=null,lastQrToken='';
let actionBusy=new Set(),lastTablesSig='',lastHostSig='',lastSummarySig='';

function save(){localStorage.setItem('yt_open_staff',JSON.stringify(S))}
function esc(s){return String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t,type='ok'){const d=document.createElement('div');d.className=`toast ${type==='bad'?'toastBad':''}`;d.textContent=t;document.body.appendChild(d);requestAnimationFrame(()=>d.classList.add('show'));setTimeout(()=>{d.classList.remove('show');setTimeout(()=>d.remove(),180)},2200)}
function err(e){return({active_session_exists:'已经有一场活动正在进行',staff_auth_required:'Staff 登入已过期',invalid_session_state:'当前阶段不能这样操作',table_full:'目标桌已满',game_not_live:'活动还没正式 START GAME',redemption_not_found:'找不到兑换码',already_redeemed:'已经兑换过'})[e]||e||'操作失败'}
function stopTimers(){clearTimeout(pollTimer);pollTimer=null;clearTimeout(qrRefreshTimeout);clearInterval(qrCountdownTimer);qrRefreshTimeout=null;qrCountdownTimer=null}
function schedulePoll(ms=2400){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{await pollDashboard(false);schedulePoll(2400)},ms)}

function shell(body){
  app.innerHTML=`<div class="topbar"><div class="brand">YETIPSY · STAFF</div><div class="top-actions">${S.staff?`<span class="staffSync ok" id="staffSync"><i></i><span>READY</span></span><span class="badge">${esc(S.staff.name)}</span>`:''}<button class="iconBtn" id="logout">LOGOUT</button></div></div>${body}`;
  document.getElementById('logout').onclick=()=>{localStorage.removeItem('yt_open_staff');location.reload()};
}
function setSync(mode='ok',text='READY'){
  const el=document.getElementById('staffSync');if(!el)return;
  el.className=`staffSync ${mode}`;const s=el.querySelector('span');if(s)s.textContent=text;
}
function buttonBusy(btn,on,label='WORKING…'){
  if(!btn)return;
  if(on){if(!btn.dataset.originalHtml)btn.dataset.originalHtml=btn.innerHTML;btn.disabled=true;btn.classList.add('isLoading');btn.innerHTML=`<span class="miniSpinner"></span><span>${esc(label)}</span>`}
  else{btn.disabled=false;btn.classList.remove('isLoading');if(btn.dataset.originalHtml){btn.innerHTML=btn.dataset.originalHtml;delete btn.dataset.originalHtml}}
}
async function runAction(key,btn,label,fn){
  if(actionBusy.has(key))return;
  actionBusy.add(key);buttonBusy(btn,true,label);setSync('syncing',label);
  try{return await fn()}
  catch(e){console.error(e);toast('网络或后台响应失败','bad');setSync('error','RETRY')}
  finally{actionBusy.delete(key);if(document.body.contains(btn))buttonBusy(btn,false);if(!actionBusy.size)setTimeout(()=>setSync('ok','READY'),250)}
}
function isEditing(containerId){const el=document.getElementById(containerId),a=document.activeElement;return !!(el&&a&&el.contains(a)&&/INPUT|SELECT|TEXTAREA/.test(a.tagName))}
function sig(v){try{return JSON.stringify(v)}catch{return String(Date.now())}}
function flashUpdate(el){if(!el)return;el.classList.remove('softUpdated');void el.offsetWidth;el.classList.add('softUpdated')}

function loadingShell(title='LOADING STAFF CONTROL'){
  shell(`<div class="staffLoadHead"><div class="kicker">${esc(title)}</div><div class="loadingLine"><i></i></div></div>
  <div class="skeletonCard"><div class="skeleton skWide"></div><div class="skeleton skMid"></div><div class="skeleton skShort"></div></div>
  <div class="grid2"><div class="skeletonCard"><div class="skeleton skMid"></div><div class="skeleton skWide"></div><div class="skeleton skWide"></div></div><div class="skeletonCard"><div class="skeleton skMid"></div><div class="skeleton skWide"></div><div class="skeleton skWide"></div></div></div>`)
}

async function init(){
  if(!S.authToken)return login();
  loadingShell();
  setSync('syncing','LOADING');
  const r=await API.post('staffDashboard',{authToken:S.authToken});
  if(!r.ok)return login();
  S.staff=r.staff;save();dashboard(r);
}

function login(){
  stopTimers();
  shell(`<div class="hero"><div class="kicker">TONIGHT CONTROL</div><h1 class="display">今晚<br>开局。</h1><p class="lead">Staff / Host 后台</p></div><div class="card"><label>Staff ID</label><input class="field" id="sid" value="staff"><label>PIN</label><input class="field" id="pin" inputmode="numeric" type="password"></div><button class="btn primary" id="login">LOGIN</button>`);
  const btn=document.getElementById('login');
  btn.onclick=()=>runAction('login',btn,'SIGNING IN…',async()=>{
    const r=await API.post('staffLogin',{staffId:document.getElementById('sid').value,pin:document.getElementById('pin').value});
    if(!r.ok){toast('登入失败','bad');return}
    S.authToken=r.auth_token;S.staff=r.staff;save();await init();
  });
}

function dashboard(r){
  stopTimers();current=r;if(!r.session)return noSession();
  const s=r.session;lastTablesSig=sig(r.tables);lastHostSig=sig({m:r.active_matches,p:r.tables.map(t=>t.players.map(p=>[p.player_id,p.nickname,p.table_id]))});lastSummarySig=`${r.checkin_count}|${s.capacity}|${s.table_count}`;
  shell(`<div class="row"><div class="grow"><div class="kicker">YT GAME #${String(s.game_no).padStart(3,'0')}</div><h1 class="title" id="staffStatusTitle" style="margin-bottom:4px">${esc(s.status)}</h1><div class="small" id="checkinSummary">${r.checkin_count} / ${s.capacity} checked in · ${s.table_count} tables</div></div><span class="status ${s.status==='LIVE'?'live':''}" id="staffSessionBadge">${esc(s.session_id)}</span></div>
  <div id="qrSlot">${s.status==='CHECK_IN'?qrSection():''}</div>
  <div class="toolbar" id="staffControls" style="margin:14px 0">${controlsHtml(s.status)}<button class="btn secondary" id="refresh">SYNC NOW</button></div>
  <div class="sectionTitle"><h2>Tables</h2><span><span class="syncDot"></span>Live sync</span></div><div class="grid2" id="tablesGrid">${r.tables.map(tableCard).join('')}</div>
  <div id="hostArea">${s.status==='LIVE'?hostTools(r):''}</div>
  <div class="sectionTitle"><h2>Reward Redemption</h2></div><div class="card"><div class="row"><input class="field grow" id="redeemToken" inputmode="numeric" maxlength="6" placeholder="6-digit redemption code"><button class="btn primary" id="redeem" style="width:auto;margin:0">CONFIRM</button></div></div>`);
  setSync('ok','LIVE');wireStatic();wireDynamic();if(s.status==='CHECK_IN')startQrRotation();schedulePoll();
}
function controlsHtml(status){return status==='CHECK_IN'?`<button class="btn primary" id="lock">LOCK TABLES</button>`:status==='TABLES_LOCKED'?`<button class="btn primary" id="start">START GAME</button>`:status==='LIVE'?`<button class="btn danger" id="end">END SESSION</button>`:''}
function noSession(){
  stopTimers();current={session:null,tables:[],active_matches:[]};
  shell(`<div class="hero"><div class="kicker">NO ACTIVE SESSION</div><h1 class="title">开一场新的「今晚开局」。</h1></div><div class="card"><div class="grid3"><div><label>Capacity</label><input class="field" id="capacity" type="number" value="10"></div><div><label>Tables</label><input class="field" id="tables" type="number" value="2"></div><div><label>Seats / Table</label><input class="field" id="size" type="number" value="5"></div></div><label>Start Time（显示用）</label><input class="field" id="time" type="time"><div class="small" style="margin-top:10px">默认开启 Hidden Mission / Coin / Team Score / Auto Assign。</div></div><button class="btn primary" id="open">OPEN SESSION</button>`);
  const btn=document.getElementById('open');
  btn.onclick=()=>runAction('open',btn,'OPENING…',async()=>{
    const r=await API.post('createSession',{authToken:S.authToken,capacity:+document.getElementById('capacity').value,tableCount:+document.getElementById('tables').value,tableSize:+document.getElementById('size').value,startTime:document.getElementById('time').value,hiddenMissionEnabled:true,coinEnabled:true,leaderboardEnabled:true,autoAssign:true});
    if(!r.ok)return toast(err(r.error),'bad');toast('Session 已开启');await fullRefresh(false);
  });
}
function qrSection(){return `<div class="card gold"><div class="row"><div class="grow"><div class="kicker">TONIGHT CHECK-IN QR</div><div class="small">QR stays stable for the current token. Player arrivals sync automatically.</div></div><span class="status live"><span class="syncDot"></span>LIVE</span></div><div class="qrWrap" id="qr"><div class="qrLoading"><span class="bigSpinner"></span><span>GENERATING QR</span></div></div><div class="countdownText" id="qrCount">Generating token…</div><pre class="codebox" id="joinLink"></pre></div>`}
function tableCard(t){return `<div class="card tableCard" data-table-card="${esc(t.table_id)}"><div class="row"><div class="grow"><h3>TABLE ${esc(t.table_id)}</h3><span class="small">${t.players.length}/${t.capacity}</span></div><div class="coin" style="font-size:26px">${t.score}</div></div>${t.players.length?t.players.map(p=>`<div class="playerLine"><div><b>${esc(p.nickname)}</b><br><span>${esc(p.player_id)} · ${esc(p.seat_code)} · Mission ${esc(p.mission_status)}</span></div><select class="moveSelect" data-player="${esc(p.player_id)}" style="width:auto"><option value="">MOVE…</option>${current.tables.filter(x=>x.table_id!==t.table_id).map(x=>`<option value="${esc(x.table_id)}">TABLE ${esc(x.table_id)}</option>`).join('')}</select></div>`).join(''):'<div class="small">No players yet</div>'}</div>`}
function hostTools(r){const players=r.tables.flatMap(t=>t.players.map(p=>({...p,table_id:t.table_id})));return `<div class="sectionTitle"><h2>Host Event</h2><span>Only Host events change Team Score</span></div><div class="card"><div class="grid2"><div><label>Stage Player</label><select id="stagePlayer">${players.map(p=>`<option value="${esc(p.player_id)}">${esc(p.nickname)} · ${esc(p.player_id)}</option>`).join('')}</select><button class="btn secondary" id="stageBtn">RECORD STAGE</button></div><div><label>Formal Table Match</label><select id="playerA">${players.map(p=>`<option value="${esc(p.player_id)}">${esc(p.nickname)} · T${esc(p.table_id)}</option>`).join('')}</select><select id="playerB" style="margin-top:8px">${players.map(p=>`<option value="${esc(p.player_id)}">${esc(p.nickname)} · T${esc(p.table_id)}</option>`).join('')}</select><input class="field" id="matchGame" style="margin-top:8px" placeholder="反应杯 / 自选"><button class="btn primary" id="newMatch">NEW TABLE MATCH</button></div></div></div>${r.active_matches.length?`<div class="sectionTitle"><h2>Active Match</h2></div>${r.active_matches.map(m=>`<div class="card activeMatchCard"><b>${esc(m.game)}</b><div class="small">TABLE ${esc(m.table_a)} VS TABLE ${esc(m.table_b)}</div><div class="grid2"><button class="btn secondary winBtn" data-id="${esc(m.match_id)}" data-table="${esc(m.table_a)}">${esc(m.table_a)} WIN</button><button class="btn secondary winBtn" data-id="${esc(m.match_id)}" data-table="${esc(m.table_b)}">${esc(m.table_b)} WIN</button></div></div>`).join('')}`:''}`}

function wireStatic(){
  const refresh=document.getElementById('refresh');refresh.onclick=()=>runAction('refresh',refresh,'SYNCING…',()=>pollDashboard(true));
  const l=document.getElementById('lock');if(l)l.onclick=()=>act('lockTables',l,'LOCKING…','Tables locked');
  const s=document.getElementById('start');if(s)s.onclick=()=>act('startGame',s,'STARTING…','Game started');
  const e=document.getElementById('end');if(e)e.onclick=()=>{if(confirm('结束本场？结束后不能继续签到和 Challenge。'))act('endSession',e,'ENDING…','Session ended')};
  const redeem=document.getElementById('redeem');redeem.onclick=()=>runAction('redeem',redeem,'CHECKING…',async()=>{
    const input=document.getElementById('redeemToken'),token=input.value.trim();if(!token)return toast('先输入兑换码','bad');
    const x=await API.post('confirmRedemption',{authToken:S.authToken,token});if(!x.ok)return toast(err(x.error),'bad');
    input.value='';toast(`兑换成功 · 扣 ${x.cost} Coin`);flashUpdate(input.closest('.card'));await pollDashboard(false);
  });
}
function wireDynamic(){
  document.querySelectorAll('.moveSelect').forEach(sel=>sel.onchange=()=>{
    if(!sel.value)return;const target=sel.value;const key=`move:${sel.dataset.player}`;
    runAction(key,null,'MOVING…',async()=>{
      sel.disabled=true;sel.classList.add('controlBusy');setSync('syncing','MOVING');
      const r=await API.post('movePlayer',{authToken:S.authToken,sessionId:current.session.session_id,playerId:sel.dataset.player,tableId:target});
      if(!r.ok){sel.disabled=false;sel.classList.remove('controlBusy');sel.value='';return toast(err(r.error),'bad')}
      toast('已换桌');await pollDashboard(true);
    });
  });
  const st=document.getElementById('stageBtn');if(st)st.onclick=()=>runAction('stage',st,'RECORDING…',async()=>{
    const r=await API.post('recordStagePlayer',{authToken:S.authToken,sessionId:current.session.session_id,playerId:document.getElementById('stagePlayer').value});
    if(!r.ok)return toast(err(r.error),'bad');toast('已记录 STAGE');await pollDashboard(true);
  });
  const nm=document.getElementById('newMatch');if(nm)nm.onclick=()=>runAction('newMatch',nm,'CREATING…',async()=>{
    const a=playerObj(document.getElementById('playerA').value),b=playerObj(document.getElementById('playerB').value);if(!a||!b||a.table_id===b.table_id)return toast('请选择不同桌代表','bad');
    const x=await API.post('createTableMatch',{authToken:S.authToken,sessionId:current.session.session_id,tableA:a.table_id,tableB:b.table_id,playerA:a.player_id,playerB:b.player_id,game:document.getElementById('matchGame').value||'自选'});
    if(!x.ok)return toast(err(x.error),'bad');toast('Formal Match 已建立');await pollDashboard(true);
  });
  document.querySelectorAll('.winBtn').forEach(btn=>btn.onclick=()=>runAction(`win:${btn.dataset.id}`,btn,'UPDATING…',async()=>{
    const x=await API.post('finishTableMatch',{authToken:S.authToken,matchId:btn.dataset.id,winnerTable:btn.dataset.table});
    if(!x.ok)return toast(err(x.error),'bad');toast(`TABLE ${btn.dataset.table} +1`);await pollDashboard(true);
  }));
}
function playerObj(id){for(const t of current.tables){const p=t.players.find(x=>x.player_id===id);if(p)return{...p,table_id:t.table_id}}return null}
async function act(action,btn,label,success){
  return runAction(`act:${action}`,btn,label,async()=>{
    const r=await API.post(action,{authToken:S.authToken,sessionId:current.session.session_id});if(!r.ok)return toast(err(r.error),'bad');
    toast(success);await fullRefresh(false);
  });
}
async function fullRefresh(showLoader=false){
  if(showLoader)loadingShell('REFRESHING CONTROL');else setSync('syncing','SYNCING');
  const r=await API.post('staffDashboard',{authToken:S.authToken,sessionId:current?.session?.session_id});
  if(!r.ok){if(r.error==='staff_auth_required')return login();setSync('error','RETRY');return toast(err(r.error),'bad')}
  dashboard(r);
}
async function pollDashboard(force=false){
  if(pollBusy)return;pollBusy=true;if(force)setSync('syncing','SYNCING');else{const el=document.getElementById('staffSync');if(el)el.classList.add('pulse')}
  try{
    const r=await API.post('staffDashboard',{authToken:S.authToken,sessionId:current?.session?.session_id});
    if(!r.ok){if(r.error==='staff_auth_required')return login();if(force)toast(err(r.error),'bad');setSync('error','RETRY');return}
    if(!r.session||!current?.session||r.session.session_id!==current.session.session_id||r.session.status!==current.session.status){return dashboard(r)}

    current=r;
    const summarySig=`${r.checkin_count}|${r.session.capacity}|${r.session.table_count}`;
    if(summarySig!==lastSummarySig){lastSummarySig=summarySig;const el=document.getElementById('checkinSummary');if(el){el.textContent=`${r.checkin_count} / ${r.session.capacity} checked in · ${r.session.table_count} tables`;flashUpdate(el)}}

    const ts=sig(r.tables);
    if(ts!==lastTablesSig&&!isEditing('tablesGrid')){
      lastTablesSig=ts;const grid=document.getElementById('tablesGrid');if(grid){grid.innerHTML=r.tables.map(tableCard).join('');flashUpdate(grid)}
    }

    const hs=sig({m:r.active_matches,p:r.tables.map(t=>t.players.map(p=>[p.player_id,p.nickname,p.table_id]))});
    if(hs!==lastHostSig&&!isEditing('hostArea')){
      lastHostSig=hs;const host=document.getElementById('hostArea');if(host){host.innerHTML=r.session.status==='LIVE'?hostTools(r):'';flashUpdate(host)}
    }
    wireDynamic();setSync('ok','LIVE');if(force)toast('已同步');
  }finally{pollBusy=false;const el=document.getElementById('staffSync');if(el)el.classList.remove('pulse')}
}

async function startQrRotation(){
  clearTimeout(qrRefreshTimeout);clearInterval(qrCountdownTimer);
  const r=await API.post('getCheckinToken',{authToken:S.authToken,sessionId:current.session.session_id});if(!r.ok)return;
  const u=new URL('index.html',location.href);u.searchParams.set('sid',r.session_id);u.searchParams.set('token',r.token);
  if(r.token!==lastQrToken){
    lastQrToken=r.token;const q=document.getElementById('qr');
    if(q){q.classList.add('qrChanging');setTimeout(()=>{q.innerHTML='';if(window.QRCode)new QRCode(q,{text:u.toString(),width:230,height:230,correctLevel:QRCode.CorrectLevel.M});else q.textContent='QR library unavailable';q.classList.remove('qrChanging')},120)}
    const link=document.getElementById('joinLink');if(link)link.textContent=u.toString();
  }
  const end=Date.now()+Number(r.expires_in_ms||60000);updateQrCountdown(end);qrCountdownTimer=setInterval(()=>updateQrCountdown(end),1000);
  qrRefreshTimeout=setTimeout(startQrRotation,Math.max(3000,Number(r.expires_in_ms||60000)+350));
}
function updateQrCountdown(end){const el=document.getElementById('qrCount');if(!el)return;const sec=Math.max(0,Math.ceil((end-Date.now())/1000));el.textContent=`Current QR valid · refreshes in ${sec}s · previous QR has grace period`}

init();
