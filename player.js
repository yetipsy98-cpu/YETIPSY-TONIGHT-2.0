const app=document.getElementById('app');
const API=YT_API;
const qs=new URLSearchParams(location.search);
const joinSid=qs.get('sid')||'';
const joinToken=qs.get('token')||'';
let state=JSON.parse(localStorage.getItem('yt_open_player')||'{}');
if(!state.deviceId) state.deviceId=(crypto.randomUUID?crypto.randomUUID():'d-'+Date.now()+'-'+Math.random().toString(36).slice(2));
state.notifiedChallenges=state.notifiedChallenges||[];
state.notifiedClaims=state.notifiedClaims||[];
state.outgoingStates=state.outgoingStates||{};
let syncTimer=null,syncBusy=false,currentHome=null;

function save(){localStorage.setItem('yt_open_player',JSON.stringify(state))}
function esc(s){return String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t,ms=2400){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),ms)}
function cleanJoinUrl(){try{history.replaceState({},document.title,location.pathname)}catch(e){}}
function errorText(e){return ({backend_not_configured:'还没填写 Apps Script API URL',qr_expired:'签到 QR 已刷新，请重新扫描 Staff QR',session_full:'本场人数已满',checkin_closed:'签到已经结束',session_closed:'签到已经结束',phone_exists:'这个 WhatsApp 已注册，请用老玩家登入',login_failed:'号码或 PIN 不正确',login_locked:'连续输入错误太多，请稍后再试',player_auth_required:'登入已过期，请重新登入',challenge_pending:'你还有一个 Challenge 等待处理中',game_not_live:'活动还没正式开始',target_must_be_other_table:'请选择另一桌玩家'})[e]||e||'发生错误'}
function stopSync(){clearTimeout(syncTimer);syncTimer=null}
function scheduleSync(ms=6500){stopSync();syncTimer=setTimeout(syncNow,ms)}
function shell(body,profileMode=false){app.innerHTML=`<div class="topbar"><div class="brand">YETIPSY</div><div class="top-actions">${state.authToken?`<button class="iconBtn" id="notifyTop">${NotificationSupported()?(Notification.permission==='granted'?'ALERTS ✓':'ALERTS'):''}</button>`:''}<div class="badge">${profileMode?'MY PROFILE':'今晚开局'}</div></div></div><div id="screen">${body}</div><div class="footer">打开 · 看一眼 · 操作 · 收手机</div>`;const n=document.getElementById('notifyTop');if(n)n.onclick=enableNotifications}
function NotificationSupported(){return 'Notification' in window}

async function init(){
  save();registerServiceWorker();
  if(joinSid&&joinToken)return joinGate();
  if(state.authToken){
    if(state.sessionId)return home();
    return profileLanding();
  }
  publicLanding();
}

function publicLanding(){
  stopSync();
  shell(`<div class="hero"><div class="kicker">YETIPSY · TONIGHT</div><h1 class="display">今晚<br>开局。</h1><p class="lead">到店参加活动请扫描 Staff 当晚签到 QR。</p></div><div class="card"><span class="pill">PLAYER ACCOUNT</span><p class="lead" style="margin:14px 0 0">老玩家在家也可以登入查看 Tipsy Coin、Player QR 和奖励。</p></div><button class="btn primary" id="profileLogin">MY PROFILE</button><div class="notice"><b>今晚要加入？</b><br><span class="small">到 Yetipsy 后扫描 Staff 的 CHECK-IN QR。</span></div>`,true);
  document.getElementById('profileLogin').onclick=standaloneLoginDrawer;
}

async function joinGate(){
  shell(`<div class="hero"><div class="kicker">CHECKING TONIGHT</div><h1 class="title">正在确认今晚签到…</h1><p class="lead">这枚 QR 只用于当晚到店签到。</p></div>`);
  const gate=await API.post('validateJoin',{sessionId:joinSid,token:joinToken});
  if(!gate.ok)return shell(`<div class="hero"><div class="kicker">CHECK-IN</div><h1 class="title">这个签到码不能用了。</h1><p class="lead">${esc(errorText(gate.error))}</p><p class="small">请直接重新扫 Staff 现在屏幕上的 QR。</p></div>`);
  state.join={sid:joinSid,token:joinToken};save();
  if(state.authToken){
    const r=await API.post('resumeAndCheckIn',{authToken:state.authToken,sessionId:joinSid,token:joinToken,deviceId:state.deviceId});
    if(r.ok){state.sessionId=joinSid;save();cleanJoinUrl();return checkinSuccess(r.checkin)}
  }
  authChoice(gate.session);
}

function authChoice(session){
  shell(`<div class="hero"><div class="kicker">YT GAME #${String(session.game_no).padStart(3,'0')}</div><h1 class="title">WELCOME TO YETIPSY</h1><p class="lead">第一次来建立长期 Player ID；老玩家直接登入。</p></div><div class="tabs"><button class="tab active" id="newTab">第一次来</button><button class="tab" id="oldTab">老玩家</button></div><div id="authBox"></div>`);
  const box=document.getElementById('authBox');
  function newForm(){document.getElementById('newTab').classList.add('active');document.getElementById('oldTab').classList.remove('active');box.innerHTML=`<div class="card"><label>Nickname</label><input class="field" id="nick" maxlength="24" placeholder="Ken"><label>WhatsApp Number</label><input class="field" id="phone" inputmode="tel" placeholder="6012xxxxxxx"><label>4-digit Login PIN</label><input class="field" id="pin" inputmode="numeric" maxlength="4" placeholder="2580"><label>同行 Player Code（可选）</label><input class="field" id="companion" placeholder="YT-P0017"><button class="btn secondary" type="button" onclick="scanCompanion()">SCAN FRIEND PLAYER QR</button><p class="small">两人同行优先同桌；3人以上会开始拆桌。</p></div><button class="btn primary" id="join">JOIN TONIGHT</button>`;document.getElementById('join').onclick=register}
  function oldForm(){document.getElementById('oldTab').classList.add('active');document.getElementById('newTab').classList.remove('active');box.innerHTML=`<div class="card"><label>WhatsApp Number</label><input class="field" id="phone" inputmode="tel"><label>4-digit PIN</label><input class="field" id="pin" inputmode="numeric" maxlength="4"><label>同行 Player Code（可选）</label><input class="field" id="companion" placeholder="YT-P0017"><button class="btn secondary" type="button" onclick="scanCompanion()">SCAN FRIEND PLAYER QR</button></div><button class="btn primary" id="join">CHECK IN</button>`;document.getElementById('join').onclick=login}
  document.getElementById('newTab').onclick=newForm;document.getElementById('oldTab').onclick=oldForm;newForm();
}

async function register(){const btn=document.getElementById('join');btn.disabled=true;btn.textContent='JOINING…';const r=await API.post('registerAndCheckIn',{sessionId:joinSid,token:joinToken,deviceId:state.deviceId,nickname:document.getElementById('nick').value,phone:document.getElementById('phone').value,pin:document.getElementById('pin').value,companionCode:document.getElementById('companion').value});if(!r.ok){btn.disabled=false;btn.textContent='JOIN TONIGHT';return toast(errorText(r.error))}state.authToken=r.auth_token;state.playerId=r.player_id;state.sessionId=joinSid;save();cleanJoinUrl();checkinSuccess(r.checkin)}
async function login(){const btn=document.getElementById('join');btn.disabled=true;btn.textContent='CHECKING…';const r=await API.post('loginAndCheckIn',{sessionId:joinSid,token:joinToken,deviceId:state.deviceId,phone:document.getElementById('phone').value,pin:document.getElementById('pin').value,companionCode:document.getElementById('companion').value});if(!r.ok){btn.disabled=false;btn.textContent='CHECK IN';return toast(errorText(r.error))}state.authToken=r.auth_token;state.playerId=r.player_id;state.sessionId=joinSid;save();cleanJoinUrl();checkinSuccess(r.checkin)}

function checkinSuccess(c){
  shell(`<div class="hero"><div class="kicker">YOU'RE IN</div><h1 class="title">今晚已签到。</h1></div><div class="card gold"><div class="small">YOUR TABLE</div><div class="bigTable">${esc(c.table_id)}</div><div class="lead" style="margin:10px 0 0">Seat · <b style="color:var(--ink)">${esc(c.seat_code)}</b></div></div><button class="btn primary" id="enterHome">ENTER TONIGHT</button>${NotificationSupported()&&Notification.permission!=='granted'?`<button class="btn secondary" id="enableAlerts">ENABLE CHALLENGE ALERTS</button><p class="small" style="text-align:center">页面在后台时，新 Challenge 可弹通知。</p>`:''}`);
  document.getElementById('enterHome').onclick=home;const b=document.getElementById('enableAlerts');if(b)b.onclick=enableNotifications;
}

async function home(){
  stopSync();
  shell(`<div class="hero"><div class="kicker">LOADING TONIGHT</div><h1 class="title">正在恢复你的今晚…</h1></div>`);
  const r=await API.post('playerHome',{authToken:state.authToken,sessionId:state.sessionId});
  if(!r.ok){
    if(r.error==='player_auth_required'){clearAuth();return publicLanding()}
    shell(`<div class="hero"><h1 class="title">暂时连不到今晚。</h1><p class="lead">${esc(errorText(r.error))}</p><button class="btn primary" id="retryHome">RETRY</button><button class="btn secondary" id="myProfileFallback">MY PROFILE</button></div>`,true);
    document.getElementById('retryHome').onclick=home;document.getElementById('myProfileFallback').onclick=profileLanding;return;
  }
  if(!r.session)return profileLanding();
  state.sessionId=r.session.session_id;save();currentHome=r;renderHomeShell(r);processRealtime(r,true);scheduleSync();
}

function renderHomeShell(r){
  const ended=r.session.status==='ENDED';
  const scores=(r.scores||[]).slice(0,2);
  shell(`<div class="identity"><div class="avatar" id="avatar">${esc(r.player.nickname.slice(0,1).toUpperCase())}</div><div><b id="nickText">${esc(r.player.nickname)}</b><span id="identityMeta">${esc(r.player.player_id)} · TABLE ${esc(r.table_id||'-')} · ${esc(r.seat_code||'')}</span></div></div>
  <div class="card gold"><div class="row"><div class="grow"><div class="small">TIPSY COIN</div><div class="coin" id="coinValue">🪙 ${Number(r.coin_balance||0)}</div></div><div style="text-align:right"><div class="small">YT GAME</div><b id="gameNo">#${String(r.session.game_no).padStart(3,'0')}</b><div id="sessionStatus" class="status ${r.session.status==='LIVE'?'live':''}">${esc(r.session.status)}</div></div></div></div>
  <div id="scoreSlot">${scoreHtml(scores)}</div><div id="missionSlot">${missionPreview(r.mission,r.session.status)}</div><div id="endedSlot">${ended?endedHtml():''}</div>
  <div class="grid2"><button class="btn secondary" id="missionBtn">MY MISSION</button><button class="btn secondary" id="challengeBtn" ${r.session.status!=='LIVE'?'disabled':''}>CHALLENGE</button></div>
  <div class="grid2"><button class="btn secondary" id="tonightBtn">TONIGHT</button><button class="btn secondary" id="profileBtn">MY PROFILE</button></div>
  ${NotificationSupported()&&Notification.permission!=='granted'?`<button class="btn ghost" id="alertsInline">Enable Challenge Alerts</button>`:''}`);
  bindHomeButtons();
}

function bindHomeButtons(){
  document.getElementById('missionBtn').onclick=()=>missionDrawer(currentHome?.mission);
  document.getElementById('challengeBtn').onclick=challengeDrawer;
  document.getElementById('tonightBtn').onclick=()=>{toast('状态已同步');syncNow(true)};
  document.getElementById('profileBtn').onclick=profileDrawer;
  const a=document.getElementById('alertsInline');if(a)a.onclick=enableNotifications;
}

function applyHomePatch(r){
  currentHome=r;state.sessionId=r.session.session_id;save();
  text('coinValue','🪙 '+Number(r.coin_balance||0));
  text('gameNo','#'+String(r.session.game_no).padStart(3,'0'));
  const st=document.getElementById('sessionStatus');if(st){st.textContent=r.session.status;st.className='status '+(r.session.status==='LIVE'?'live':'')}
  text('identityMeta',`${r.player.player_id} · TABLE ${r.table_id||'-'} · ${r.seat_code||''}`);
  html('scoreSlot',scoreHtml((r.scores||[]).slice(0,2)));
  html('missionSlot',missionPreview(r.mission,r.session.status));
  html('endedSlot',r.session.status==='ENDED'?endedHtml():'');
  const c=document.getElementById('challengeBtn');if(c)c.disabled=r.session.status!=='LIVE';
}
function text(id,v){const e=document.getElementById(id);if(e)e.textContent=v}
function html(id,v){const e=document.getElementById(id);if(e)e.innerHTML=v}
function endedHtml(){return `<div class="notice"><b>TONIGHT IS OVER</b><br><span class="small">Coin 已保留。你可以随时从 MY PROFILE 查看。</span></div>`}
function scoreHtml(scores){if(scores.length<2)return'';return `<div class="card flat"><div class="small" style="text-align:center">TONIGHT</div><div class="scoreboard"><div class="scoreSide"><span>TABLE ${esc(scores[0].table_id)}</span><b>${scores[0].score}</b></div><div class="vs">VS</div><div class="scoreSide"><span>TABLE ${esc(scores[1].table_id)}</span><b>${scores[1].score}</b></div></div></div>`}
function missionPreview(m,status){if(!m||!['TABLES_LOCKED','LIVE','ENDED'].includes(status))return `<div class="card"><div class="small">SECRET MISSION</div><p class="lead" style="margin:8px 0 0">分桌锁定后才会出现。</p></div>`;const done=m.status==='COMPLETED';return `<div class="card"><div class="small">SECRET MISSION</div><h3 style="margin:8px 0">${done?'✅ MISSION COMPLETE':'🎭 点击 MY MISSION 查看'}</h3><span class="status">${esc(m.status)}</span></div>`}

async function syncNow(manual=false){
  if(syncBusy||!state.authToken||!state.sessionId)return scheduleSync();syncBusy=true;
  try{
    const r=await API.post('playerHome',{authToken:state.authToken,sessionId:state.sessionId});
    if(r.ok&&r.session){applyHomePatch(r);processRealtime(r,false)}
    else if(r.error==='player_auth_required'){stopSync();clearAuth();toast('登入已过期，请重新登入')}
    else if(manual)toast(errorText(r.error));
  }finally{syncBusy=false;scheduleSync(document.hidden?9000:6500)}
}

function processRealtime(r,initial){
  const c=r.incoming_challenge;
  if(c&&!state.notifiedChallenges.includes(c.challenge_id)){
    state.notifiedChallenges=[...state.notifiedChallenges.slice(-19),c.challenge_id];save();
    alertUser(`TABLE ${c.from_table} · ${c.from_nickname}`,`向你发起 ${c.game} Challenge`);
    incomingChallengeDrawer(c);
  }else if(c&&initial){
    incomingChallengeDrawer(c);
  }
  const mc=r.mission_confirmation;
  if(mc&&!state.notifiedClaims.includes(mc.from_player_id+':'+state.sessionId)){
    state.notifiedClaims=[...state.notifiedClaims.slice(-19),mc.from_player_id+':'+state.sessionId];save();
    alertUser('需要你确认一次互动',`${mc.from_nickname} 正在等你的确认`);
    if(!c)missionConfirmDrawer(mc);
  }else if(mc&&initial&&!c){
    missionConfirmDrawer(mc);
  }
  const o=r.outgoing_challenge;
  if(o){
    const prev=state.outgoingStates[o.challenge_id];
    if(prev&&prev!==o.status&&['ACCEPTED','PASSED'].includes(o.status)){
      alertUser(o.status==='ACCEPTED'?'Challenge Accepted':'Challenge Passed',`${o.to_nickname} · TABLE ${o.to_table}`);
      openDrawer(`<div class="kicker">CHALLENGE UPDATE</div><h2 class="title">${o.status==='ACCEPTED'?'对方接受了。':'对方这次 Pass。'}</h2><div class="card flat"><b>${esc(o.to_nickname)} · TABLE ${esc(o.to_table)}</b><p class="lead" style="margin:8px 0 0">${esc(o.game)}</p></div><button class="btn primary" onclick="closeDrawer()">${o.status==='ACCEPTED'?'去找到对方':'GOT IT'}</button>`);
    }
    state.outgoingStates[o.challenge_id]=o.status;save();
  }
}

function missionDrawer(m){
  if(!m)return toast('任务还没开放');
  openDrawer(`<div class="kicker">SECRET MISSION</div><h2 class="title">${esc(m.title)}</h2><div class="card gold"><div class="missionText">${esc(m.description)}</div><p class="small">Reward · 🪙 +${m.reward_coin}<br>🤫 不要把任务内容告诉别人。</p></div>${m.status==='ACTIVE'&&m.verification==='PEER'?`<div class="card flat"><label>完成后，输入与你互动的 Player Code</label><input class="field" id="targetCode" placeholder="YT-P0008"><button class="btn primary" id="claimBtn">CLAIM MISSION</button></div>`:''}<button class="btn secondary" onclick="closeDrawer()">HIDE MISSION</button>`);
  const b=document.getElementById('claimBtn');if(b)b.onclick=claimMission;
}
async function claimMission(){const code=document.getElementById('targetCode').value.trim();const r=await API.post('claimMission',{authToken:state.authToken,sessionId:state.sessionId,targetPlayerId:code});if(!r.ok)return toast(errorText(r.error));toast('已发送互证请求');closeDrawer();syncNow()}

async function challengeDrawer(){
  openDrawer(`<div class="kicker">CHALLENGE</div><h2 class="title">挑战另一桌。</h2><p class="lead">接受后把手机收起来，现实里玩。普通 Challenge 不计 Team Score。</p><div class="card flat" id="challengeContent"><div class="small">LOADING PLAYERS…</div></div><button class="btn secondary" onclick="closeDrawer()">CLOSE</button>`);
  const r=await API.post('getChallengeTargets',{authToken:state.authToken,sessionId:state.sessionId});
  const box=document.getElementById('challengeContent');if(!box)return;
  if(!r.ok){box.innerHTML=`<div class="bad">${esc(errorText(r.error))}</div>`;return}
  if(!r.targets.length){box.innerHTML=`<div class="small">现在没有其他桌玩家可以挑战。</div>`;return}
  box.innerHTML=`<label>Player</label><select id="target">${r.targets.map(x=>`<option value="${esc(x.player_id)}">TABLE ${esc(x.table_id)} · ${esc(x.nickname)}</option>`).join('')}</select><label>Game</label><select id="game"><option>十五二十</option><option>大话骰</option><option>抓手指</option><option>猜拳</option><option>自选</option></select><button class="btn primary" id="sendChallenge">SEND CHALLENGE</button>`;
  document.getElementById('sendChallenge').onclick=sendChallenge;
}
async function sendChallenge(){const b=document.getElementById('sendChallenge');b.disabled=true;b.textContent='SENDING…';const r=await API.post('sendChallenge',{authToken:state.authToken,sessionId:state.sessionId,toPlayerId:document.getElementById('target').value,game:document.getElementById('game').value});if(!r.ok){b.disabled=false;b.textContent='SEND CHALLENGE';return toast(errorText(r.error))}toast('Challenge 已发出');closeDrawer();syncNow()}

function incomingChallengeDrawer(c){
  openDrawer(`<div class="drawerUrgent"><div class="kicker">INCOMING CHALLENGE</div><h2 class="title">${esc(c.from_nickname)} 找你。</h2><div class="card flat"><b>TABLE ${esc(c.from_table)}</b><p class="lead" style="margin:8px 0 0">${esc(c.game)}</p></div><div class="grid2"><button class="btn primary" id="acceptCh">ACCEPT</button><button class="btn secondary" id="passCh">PASS</button></div><button class="btn ghost" onclick="closeDrawer()">LATER</button></div>`);
  document.getElementById('acceptCh').onclick=()=>respondChallenge(c.challenge_id,true);document.getElementById('passCh').onclick=()=>respondChallenge(c.challenge_id,false);
}
async function respondChallenge(id,accept){const r=await API.post('respondChallenge',{authToken:state.authToken,challengeId:id,accept});if(!r.ok)return toast(errorText(r.error));closeDrawer();toast(accept?'已接受。去找到对方。':'已略过');syncNow()}
function missionConfirmDrawer(c){openDrawer(`<div class="kicker">CONFIRM AN INTERACTION</div><h2 class="title">${esc(c.from_nickname)} 刚才是否与你完成了一次现场互动？</h2><p class="lead">不会显示对方的隐藏任务内容。</p><div class="grid2"><button class="btn primary" id="yesClaim">YES</button><button class="btn secondary" id="noClaim">NO</button></div><button class="btn ghost" onclick="closeDrawer()">LATER</button>`);document.getElementById('yesClaim').onclick=()=>confirmClaim(c.from_player_id,true);document.getElementById('noClaim').onclick=()=>confirmClaim(c.from_player_id,false)}
async function confirmClaim(pid,approve){const r=await API.post('confirmMissionClaim',{authToken:state.authToken,sessionId:state.sessionId,fromPlayerId:pid,approve});if(!r.ok)return toast(errorText(r.error));closeDrawer();toast(approve?'已确认':'已拒绝');syncNow()}

async function profileDrawer(){
  openDrawer(`<div class="kicker">MY PROFILE</div><h2 class="title">读取长期资料…</h2>`);
  const r=await API.post('playerProfile',{authToken:state.authToken});if(!r.ok)return drawerError(r.error);renderProfileIntoDrawer(r);
}
function renderProfileIntoDrawer(r){
  setDrawer(`<div class="identity"><div class="avatar">${esc(r.player.nickname.slice(0,1).toUpperCase())}</div><div><b>${esc(r.player.nickname)}</b><span>${esc(r.player.player_id)}</span></div></div><div class="grid3" style="margin-top:14px"><div class="kpi"><b>${r.coin_balance}</b><span>COIN</span></div><div class="kpi"><b>${r.player.lifetime_sessions}</b><span>SESSIONS</span></div><div class="kpi"><b>${r.missions_completed}</b><span>MISSIONS</span></div></div><div class="sectionTitle"><h2>Player QR</h2><span>同行 / 快速识别</span></div><div class="card flat"><div class="qrWrap smallQr" id="playerQr"></div><div class="small" style="text-align:center;margin-top:10px">${esc(r.player.player_id)} · 这不是签到 QR</div></div><div class="sectionTitle"><h2>Rewards</h2><span>长期保留</span></div><div class="list">${r.rewards.map(x=>`<div class="listItem"><div class="grow"><b>${esc(x.name)}</b><div class="meta">🪙 ${x.cost} · ${esc(x.description)}</div></div><button class="iconBtn redeem" data-id="${esc(x.reward_id)}" ${r.coin_balance<x.cost?'disabled':''}>REDEEM</button></div>`).join('')}</div><div class="sectionTitle"><h2>Recent Coin</h2></div><div class="list">${r.ledger.length?r.ledger.slice(0,12).map(x=>`<div class="listItem"><div class="grow"><b>${esc(x.reason)}</b><div class="meta">${esc(x.created_at)}</div></div><b class="${Number(x.delta)>=0?'ok':'bad'}">${Number(x.delta)>=0?'+':''}${x.delta}</b></div>`).join(''):'<div class="small">还没有 Coin 记录。</div>'}</div><button class="btn secondary" onclick="closeDrawer()">CLOSE</button>`);
  drawPlayerQr(r.player.player_id);document.querySelectorAll('.redeem').forEach(b=>b.onclick=()=>redeem(b.dataset.id));
}

async function profileLanding(){
  stopSync();
  shell(`<div class="hero"><div class="kicker">MY PROFILE</div><h1 class="title">正在读取你的长期资料…</h1></div>`,true);
  const r=await API.post('playerProfile',{authToken:state.authToken});
  if(!r.ok){if(r.error==='player_auth_required'){clearAuth();return publicLanding()}return shell(`<div class="hero"><h1 class="title">暂时无法读取 Profile。</h1><p class="lead">${esc(errorText(r.error))}</p></div>`,true)}
  const active=r.active_session;
  shell(`<div class="identity"><div class="avatar">${esc(r.player.nickname.slice(0,1).toUpperCase())}</div><div><b>${esc(r.player.nickname)}</b><span>${esc(r.player.player_id)}</span></div></div><div class="card gold"><div class="small">TIPSY COIN</div><div class="coin">🪙 ${r.coin_balance}</div><p class="small">Coin 是长期账号余额，不需要在活动现场才能查看。</p></div>${active?`<div class="notice"><b>今晚你已经签到 · TABLE ${esc(active.table_id)}</b><br><span class="small">${esc(active.session.status)}</span></div><button class="btn primary" id="returnTonight">RETURN TO TONIGHT</button>`:''}<div class="grid3"><div class="kpi"><b>${r.player.lifetime_sessions}</b><span>SESSIONS</span></div><div class="kpi"><b>${r.missions_completed}</b><span>MISSIONS</span></div><div class="kpi"><b>${r.challenges}</b><span>CHALLENGES</span></div></div><div class="sectionTitle"><h2>My Player QR</h2><span>同行 / 快速识别</span></div><div class="card flat"><div class="qrWrap smallQr" id="playerQr"></div><div class="small" style="text-align:center;margin-top:10px">${esc(r.player.player_id)}</div></div><div class="sectionTitle"><h2>Rewards</h2></div><div class="list">${r.rewards.map(x=>`<div class="listItem"><div class="grow"><b>${esc(x.name)}</b><div class="meta">🪙 ${x.cost} · ${esc(x.description)}</div></div><button class="iconBtn redeem" data-id="${esc(x.reward_id)}" ${r.coin_balance<x.cost?'disabled':''}>REDEEM</button></div>`).join('')}</div><div class="sectionTitle"><h2>Recent Coin</h2></div><div class="list">${r.ledger.length?r.ledger.slice(0,15).map(x=>`<div class="listItem"><div class="grow"><b>${esc(x.reason)}</b><div class="meta">${esc(x.created_at)}</div></div><b class="${Number(x.delta)>=0?'ok':'bad'}">${Number(x.delta)>=0?'+':''}${x.delta}</b></div>`).join(''):'<div class="small">还没有 Coin 记录。</div>'}</div><button class="btn ghost" id="logoutProfile">LOG OUT</button>`,true);
  drawPlayerQr(r.player.player_id);document.querySelectorAll('.redeem').forEach(b=>b.onclick=()=>redeem(b.dataset.id));
  const rt=document.getElementById('returnTonight');if(rt)rt.onclick=()=>{state.sessionId=active.session.session_id;save();home()};document.getElementById('logoutProfile').onclick=()=>{clearAuth();publicLanding()};
}

function standaloneLoginDrawer(){
  openDrawer(`<div class="kicker">MY PROFILE</div><h2 class="title">老玩家登入。</h2><div class="card flat"><label>WhatsApp Number</label><input class="field" id="profilePhone" inputmode="tel"><label>4-digit PIN</label><input class="field" id="profilePin" inputmode="numeric" maxlength="4"></div><button class="btn primary" id="profileLoginGo">LOGIN</button><button class="btn secondary" onclick="closeDrawer()">CLOSE</button>`);
  document.getElementById('profileLoginGo').onclick=async()=>{const b=document.getElementById('profileLoginGo');b.disabled=true;b.textContent='CHECKING…';const r=await API.post('playerLogin',{deviceId:state.deviceId,phone:document.getElementById('profilePhone').value,pin:document.getElementById('profilePin').value});if(!r.ok){b.disabled=false;b.textContent='LOGIN';return toast(errorText(r.error))}state.authToken=r.auth_token;state.playerId=r.player_id;state.sessionId='';save();closeDrawer();profileLanding()}
}

async function redeem(id){const r=await API.post('createRedemption',{authToken:state.authToken,rewardId:id});if(!r.ok)return toast(errorText(r.error));openDrawer(`<div class="kicker">REDEMPTION</div><h2 class="title">给 Staff 看这个码。</h2><div class="card gold"><div class="code" style="font-size:48px;text-align:center;color:var(--gold);letter-spacing:.15em;font-weight:900">${esc(r.token)}</div><div class="small" style="text-align:center">${esc(r.reward_name||'Reward')} · 🪙 ${r.cost||''}</div></div><button class="btn secondary" onclick="closeDrawer()">CLOSE</button>`)}

function drawPlayerQr(playerId){const qr=document.getElementById('playerQr');if(qr&&window.QRCode)new QRCode(qr,{text:'YTPLAYER:'+playerId,width:190,height:190,correctLevel:QRCode.CorrectLevel.M})}
function scanCompanion(){if(!window.Html5QrcodeScanner)return toast('这个浏览器暂时不能开扫码器，可直接输入 Player Code');openDrawer(`<div class="kicker">SCAN PLAYER QR</div><h2 class="title">扫同行朋友的 Player QR</h2><div id="reader"></div><button class="btn secondary" onclick="closeScanner()">CANCEL</button>`);setTimeout(()=>{window._ytScanner=new Html5QrcodeScanner('reader',{fps:8,qrbox:{width:220,height:220}},false);window._ytScanner.render(txt=>{const m=String(txt||'').match(/YTPLAYER:(YT-P\d+)/i);if(!m)return toast('这不是 YETIPSY Player QR');const input=document.getElementById('companion');if(input)input.value=m[1].toUpperCase();closeScanner();toast('已加入同行 Player Code')},()=>{})},50)}
function closeScanner(){try{window._ytScanner&&window._ytScanner.clear()}catch(e){}window._ytScanner=null;closeDrawer()}

function openDrawer(content){closeDrawer();const b=document.createElement('div');b.className='drawerBackdrop';b.id='drawer';b.innerHTML=`<div class="drawerPanel"><div class="drawerHandle"></div><div id="drawerBody">${content}</div></div>`;b.addEventListener('click',e=>{if(e.target===b)closeDrawer()});document.body.appendChild(b);requestAnimationFrame(()=>b.classList.add('show'))}
function setDrawer(content){const b=document.getElementById('drawerBody');if(b)b.innerHTML=content}
function drawerError(e){setDrawer(`<div class="kicker">ERROR</div><h2 class="title">暂时读取不到。</h2><p class="lead">${esc(errorText(e))}</p><button class="btn secondary" onclick="closeDrawer()">CLOSE</button>`)}
function closeDrawer(){const b=document.getElementById('drawer');if(b)b.remove()}

async function enableNotifications(){
  if(!NotificationSupported())return toast('这个浏览器不支持系统通知');
  const permission=await Notification.requestPermission();
  state.notifyEnabled=permission==='granted';save();toast(permission==='granted'?'Challenge 通知已开启':'没有开启通知权限');
  const top=document.getElementById('notifyTop');if(top)top.textContent=permission==='granted'?'ALERTS ✓':'ALERTS';
}
function alertUser(title,body){
  beep();if(navigator.vibrate)navigator.vibrate([90,60,140]);
  if(NotificationSupported()&&Notification.permission==='granted'){
    try{if(navigator.serviceWorker?.controller){navigator.serviceWorker.ready.then(r=>r.showNotification(title,{body,tag:'yetipsy-'+title,renotify:true}))}else new Notification(title,{body})}catch(e){}
  }
}
function beep(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=540;g.gain.value=.06;o.connect(g).connect(c.destination);o.start();g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.2);o.stop(c.currentTime+.21);setTimeout(()=>c.close(),350)}catch(e){}}
function registerServiceWorker(){if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=1.1.0').catch(()=>{})}
function clearAuth(){state.authToken='';state.playerId='';state.sessionId='';save();stopSync()}

document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.authToken&&state.sessionId)syncNow(true)});
window.addEventListener('focus',()=>{if(state.authToken&&state.sessionId)syncNow()});
init();
