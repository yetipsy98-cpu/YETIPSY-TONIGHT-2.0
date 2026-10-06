const app=document.getElementById('app');
const API=YT_API;
const qs=new URLSearchParams(location.search);
const joinSid=qs.get('sid')||'';
const joinToken=qs.get('token')||'';
let state=JSON.parse(localStorage.getItem('yt_open_player')||'{}');
if(!state.deviceId) state.deviceId=(crypto.randomUUID?crypto.randomUUID():'d-'+Date.now()+'-'+Math.random().toString(36).slice(2));
let homeTimer=null;
function save(){localStorage.setItem('yt_open_player',JSON.stringify(state))}
function esc(s){return String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2400)}
function shell(body){app.innerHTML=`<div class="topbar"><div class="brand">YETIPSY</div><div class="badge">今晚开局</div></div>${body}<div class="footer">打开 · 看一眼 · 操作 · 收手机</div>`}
function errorText(e){return ({backend_not_configured:'还没填写 Apps Script API URL',qr_expired:'签到 QR 已刷新，请重新扫描 Staff QR',session_full:'本场人数已满',checkin_closed:'签到已经结束',phone_exists:'这个 WhatsApp 已注册，请用老玩家登入',login_failed:'号码或 PIN 不正确',login_locked:'连续输入错误太多，请稍后再试',player_auth_required:'登入已过期，请重新扫描 Staff QR'})[e]||e||'发生错误'}

async function init(){
  save();
  if(joinSid&&joinToken){return joinGate()}
  if(state.authToken&&state.sessionId){return home()}
  shell(`<div class="hero"><div class="kicker">YETIPSY · TONIGHT</div><h1 class="display">今晚<br>开局。</h1><p class="lead">请到店后扫描 Staff 当晚签到 QR。<br>这个页面不能直接在家加入。</p></div><div class="card"><span class="pill">CHECK-IN REQUIRED</span><p class="lead" style="margin:14px 0 0">手机只负责身份、任务、比分和奖励。现场游戏，面对面玩。</p></div>`);
}

async function joinGate(){
  shell(`<div class="hero"><div class="kicker">CHECKING TONIGHT</div><h1 class="title">正在确认今晚签到…</h1><p class="lead">QR 只会短时间有效。</p></div>`);
  const gate=await API.post('validateJoin',{sessionId:joinSid,token:joinToken});
  if(!gate.ok)return shell(`<div class="hero"><div class="kicker">CHECK-IN</div><h1 class="title">这个签到码不能用了。</h1><p class="lead">${esc(errorText(gate.error))}</p><button class="btn primary" onclick="location.reload()">RETRY</button></div>`);
  state.join={sid:joinSid,token:joinToken};save();
  if(state.authToken){
    const r=await API.post('resumeAndCheckIn',{authToken:state.authToken,sessionId:joinSid,token:joinToken,deviceId:state.deviceId});
    if(r.ok){state.sessionId=joinSid;save();return checkinSuccess(r.checkin)}
  }
  authChoice(gate.session);
}

function authChoice(session){
  shell(`<div class="hero"><div class="kicker">YT GAME #${String(session.game_no).padStart(3,'0')}</div><h1 class="title">WELCOME TO YETIPSY</h1><p class="lead">第一次来就建立长期 Player ID；回来以后直接登入。</p></div>
  <div class="tabs"><button class="tab active" id="newTab">第一次来</button><button class="tab" id="oldTab">老玩家</button></div><div id="authBox"></div>`);
  const box=document.getElementById('authBox');
  function newForm(){document.getElementById('newTab').classList.add('active');document.getElementById('oldTab').classList.remove('active');box.innerHTML=`<div class="card"><label>Nickname</label><input class="field" id="nick" maxlength="24" placeholder="Ken"><label>WhatsApp Number</label><input class="field" id="phone" inputmode="tel" placeholder="6012xxxxxxx"><label>4-digit Login PIN</label><input class="field" id="pin" inputmode="numeric" maxlength="4" placeholder="2580"><label>同行 Player Code（可选）</label><input class="field" id="companion" placeholder="YT-P0017"><button class="btn secondary" type="button" onclick="scanCompanion()">SCAN FRIEND PLAYER QR</button><p class="small">两人同行优先同桌；3人以上会开始拆桌。</p></div><button class="btn primary" id="join">JOIN TONIGHT</button>`;document.getElementById('join').onclick=register}
  function oldForm(){document.getElementById('oldTab').classList.add('active');document.getElementById('newTab').classList.remove('active');box.innerHTML=`<div class="card"><label>WhatsApp Number</label><input class="field" id="phone" inputmode="tel"><label>4-digit PIN</label><input class="field" id="pin" inputmode="numeric" maxlength="4"><label>同行 Player Code（可选）</label><input class="field" id="companion" placeholder="YT-P0017"><button class="btn secondary" type="button" onclick="scanCompanion()">SCAN FRIEND PLAYER QR</button></div><button class="btn primary" id="join">CHECK IN</button>`;document.getElementById('join').onclick=login}
  document.getElementById('newTab').onclick=newForm;document.getElementById('oldTab').onclick=oldForm;newForm();
}
async function register(){const btn=document.getElementById('join');btn.disabled=true;btn.textContent='JOINING…';const r=await API.post('registerAndCheckIn',{sessionId:joinSid,token:joinToken,deviceId:state.deviceId,nickname:document.getElementById('nick').value,phone:document.getElementById('phone').value,pin:document.getElementById('pin').value,companionCode:document.getElementById('companion').value});if(!r.ok){btn.disabled=false;btn.textContent='JOIN TONIGHT';return toast(errorText(r.error))}state.authToken=r.auth_token;state.playerId=r.player_id;state.sessionId=joinSid;save();checkinSuccess(r.checkin)}
async function login(){const btn=document.getElementById('join');btn.disabled=true;btn.textContent='CHECKING…';const r=await API.post('loginAndCheckIn',{sessionId:joinSid,token:joinToken,deviceId:state.deviceId,phone:document.getElementById('phone').value,pin:document.getElementById('pin').value,companionCode:document.getElementById('companion').value});if(!r.ok){btn.disabled=false;btn.textContent='CHECK IN';return toast(errorText(r.error))}state.authToken=r.auth_token;state.playerId=r.player_id;state.sessionId=joinSid;save();checkinSuccess(r.checkin)}
function checkinSuccess(c){shell(`<div class="hero"><div class="kicker">YOU'RE IN</div><h1 class="title">今晚已签到。</h1></div><div class="card gold"><div class="small">YOUR TABLE</div><div class="bigTable">${esc(c.table_id)}</div><div class="lead" style="margin:10px 0 0">Seat · <b style="color:var(--ink)">${esc(c.seat_code)}</b></div></div><button class="btn primary" id="enterHome">ENTER TONIGHT</button>`);document.getElementById('enterHome').onclick=home}

async function home(){
  clearInterval(homeTimer);
  shell(`<div class="hero"><div class="kicker">LOADING TONIGHT</div><h1 class="title">正在拿你的今晚状态…</h1></div>`);
  const r=await API.post('playerHome',{authToken:state.authToken,sessionId:state.sessionId});
  if(!r.ok)return shell(`<div class="hero"><h1 class="title">登入需要更新。</h1><p class="lead">${esc(errorText(r.error))}</p><p class="lead">请重新扫描 Staff 签到 QR。</p></div>`);
  if(!r.session)return init();
  state.sessionId=r.session.session_id;save();renderHome(r);
  homeTimer=setInterval(refreshHome,15000);
}
async function refreshHome(){const r=await API.post('playerHome',{authToken:state.authToken,sessionId:state.sessionId});if(r.ok){if(r.incoming_challenge||r.mission_confirmation){clearInterval(homeTimer);renderHome(r)}}}
function renderHome(r){
  const scores=(r.scores||[]).slice(0,2);const ended=r.session.status==='ENDED';
  shell(`<div class="identity"><div class="avatar">${esc(r.player.nickname.slice(0,1).toUpperCase())}</div><div><b>${esc(r.player.nickname)}</b><span>${esc(r.player.player_id)} · TABLE ${esc(r.table_id||'-')} · ${esc(r.seat_code||'')}</span></div></div>
  <div class="card gold"><div class="row"><div class="grow"><div class="small">TIPSY COIN</div><div class="coin">🪙 ${Number(r.coin_balance||0)}</div></div><div style="text-align:right"><div class="small">YT GAME</div><b>#${String(r.session.game_no).padStart(3,'0')}</b><div class="status ${r.session.status==='LIVE'?'live':''}">${esc(r.session.status)}</div></div></div></div>
  ${scoreHtml(scores)}
  ${missionPreview(r.mission,r.session.status)}
  ${ended?`<div class="notice"><b>TONIGHT IS OVER</b><br><span class="small">Coin 会保留到下一场。</span></div>`:''}
  <div class="grid2"><button class="btn secondary" id="missionBtn">MY MISSION</button><button class="btn secondary" id="challengeBtn" ${r.session.status!=='LIVE'?'disabled':''}>CHALLENGE</button></div>
  <div class="grid2"><button class="btn secondary" id="tonightBtn">TONIGHT</button><button class="btn secondary" id="profileBtn">MY PROFILE</button></div>`);
  document.getElementById('missionBtn').onclick=()=>missionView(r.mission,r);
  document.getElementById('challengeBtn').onclick=challengeView;
  document.getElementById('tonightBtn').onclick=home;
  document.getElementById('profileBtn').onclick=profileView;
  if(r.incoming_challenge)incomingChallengeModal(r.incoming_challenge);
  else if(r.mission_confirmation)missionConfirmModal(r.mission_confirmation);
}
function scoreHtml(scores){if(scores.length<2)return'';return `<div class="card flat"><div class="small" style="text-align:center">TONIGHT</div><div class="scoreboard"><div class="scoreSide"><span>TABLE ${esc(scores[0].table_id)}</span><b>${scores[0].score}</b></div><div class="vs">VS</div><div class="scoreSide"><span>TABLE ${esc(scores[1].table_id)}</span><b>${scores[1].score}</b></div></div></div>`}
function missionPreview(m,status){if(!m||!['TABLES_LOCKED','LIVE','ENDED'].includes(status))return `<div class="card"><div class="small">SECRET MISSION</div><p class="lead" style="margin:8px 0 0">分桌锁定后才会出现。</p></div>`;const done=m.status==='COMPLETED';return `<div class="card"><div class="small">SECRET MISSION</div><h3 style="margin:8px 0">${done?'✅ MISSION COMPLETE':'🎭 点击查看'}</h3><span class="status">${esc(m.status)}</span></div>`}
function missionView(m,r){if(!m)return toast('任务还没开放');shell(`<div class="hero"><div class="kicker">SECRET MISSION</div><h1 class="title">${esc(m.title)}</h1></div><div class="card gold"><div class="missionText">${esc(m.description)}</div><p class="small">Reward · 🪙 +${m.reward_coin}<br>🤫 不要把任务内容告诉别人。</p></div>${m.status==='ACTIVE'&&m.verification==='PEER'?`<div class="card"><label>完成后，输入与你互动的 Player Code</label><input class="field" id="targetCode" placeholder="YT-P0008"><button class="btn primary" id="claimBtn">CLAIM MISSION</button></div>`:''}<button class="btn secondary" id="hideBtn">HIDE MISSION</button>`);document.getElementById('hideBtn').onclick=home;const b=document.getElementById('claimBtn');if(b)b.onclick=claimMission}
async function claimMission(){const code=document.getElementById('targetCode').value.trim();const r=await API.post('claimMission',{authToken:state.authToken,sessionId:state.sessionId,targetPlayerId:code});if(!r.ok)return toast(errorText(r.error));toast('已发送互证请求');home()}

async function challengeView(){shell(`<div class="hero"><div class="kicker">CHALLENGE</div><h1 class="title">挑战另一桌。</h1><p class="lead">Challenge 本身不计 Team Score。接受后，把手机收起来，现实里玩。</p></div><div class="card"><div class="small">LOADING PLAYERS…</div></div>`);const r=await API.post('getChallengeTargets',{authToken:state.authToken,sessionId:state.sessionId});if(!r.ok)return toast(errorText(r.error));if(!r.targets.length)return shell(`<div class="hero"><h1 class="title">现在没有其他桌玩家可以挑战。</h1></div><button class="btn secondary" onclick="home()">BACK</button>`);shell(`<div class="hero"><div class="kicker">CHALLENGE</div><h1 class="title">选择一个人。</h1></div><div class="card"><label>Player</label><select id="target">${r.targets.map(x=>`<option value="${esc(x.player_id)}">TABLE ${esc(x.table_id)} · ${esc(x.nickname)} · ${esc(x.player_id)}</option>`).join('')}</select><label>Game</label><select id="game"><option>十五二十</option><option>大话骰</option><option>抓手指</option><option>猜拳</option><option>自选</option></select></div><button class="btn primary" id="send">SEND CHALLENGE</button><button class="btn secondary" onclick="home()">BACK</button>`);document.getElementById('send').onclick=async()=>{const b=document.getElementById('send');b.disabled=true;const s=await API.post('sendChallenge',{authToken:state.authToken,sessionId:state.sessionId,toPlayerId:document.getElementById('target').value,game:document.getElementById('game').value});if(!s.ok){b.disabled=false;return toast(errorText(s.error))}toast('Challenge 已发出');home()}}
function incomingChallengeModal(c){modal(`<div class="kicker">INCOMING CHALLENGE</div><h2 class="title">${esc(c.from_nickname)} 向你发起挑战。</h2><div class="card flat"><b>TABLE ${esc(c.from_table)}</b><p class="lead" style="margin:8px 0 0">${esc(c.game)}</p></div><div class="grid2"><button class="btn primary" id="acceptCh">ACCEPT</button><button class="btn secondary" id="passCh">PASS</button></div>`);document.getElementById('acceptCh').onclick=()=>respondChallenge(c.challenge_id,true);document.getElementById('passCh').onclick=()=>respondChallenge(c.challenge_id,false)}
async function respondChallenge(id,accept){const r=await API.post('respondChallenge',{authToken:state.authToken,challengeId:id,accept:accept});closeModal();if(!r.ok)return toast(errorText(r.error));toast(accept?'已接受。去找到对方。':'已略过');home()}
function missionConfirmModal(c){modal(`<div class="kicker">CONFIRM AN INTERACTION</div><h2 class="title">${esc(c.from_nickname)} 刚才是否与你完成了一次现场互动？</h2><p class="lead">不会显示对方的隐藏任务内容。</p><div class="grid2"><button class="btn primary" id="yesClaim">YES</button><button class="btn secondary" id="noClaim">NO</button></div>`);document.getElementById('yesClaim').onclick=()=>confirmClaim(c.from_player_id,true);document.getElementById('noClaim').onclick=()=>confirmClaim(c.from_player_id,false)}
async function confirmClaim(pid,approve){const r=await API.post('confirmMissionClaim',{authToken:state.authToken,sessionId:state.sessionId,fromPlayerId:pid,approve:approve});closeModal();if(!r.ok)return toast(errorText(r.error));toast(approve?'已确认':'已拒绝');home()}

async function profileView(){shell(`<div class="hero"><div class="kicker">MY PROFILE</div><h1 class="title">正在读取长期资料…</h1></div>`);const r=await API.post('playerProfile',{authToken:state.authToken});if(!r.ok)return toast(errorText(r.error));shell(`<div class="identity"><div class="avatar">${esc(r.player.nickname.slice(0,1).toUpperCase())}</div><div><b>${esc(r.player.nickname)}</b><span>${esc(r.player.player_id)}</span></div></div><div class="grid3" style="margin-top:14px"><div class="kpi"><b>${r.coin_balance}</b><span>COIN</span></div><div class="kpi"><b>${r.player.lifetime_sessions}</b><span>SESSIONS</span></div><div class="kpi"><b>${r.missions_completed}</b><span>MISSIONS</span></div></div><div class="sectionTitle"><h2>My Player QR</h2><span>同行 / 快速识别</span></div><div class="card"><div class="qrWrap" id="playerQr"></div><div class="small" style="text-align:center;margin-top:10px">${esc(r.player.player_id)} · 这不是签到 QR</div></div><div class="sectionTitle"><h2>Rewards</h2><span>长期保留</span></div><div class="list">${r.rewards.map(x=>`<div class="listItem"><div class="grow"><b>${esc(x.name)}</b><div class="meta">🪙 ${x.cost} · ${esc(x.description)}</div></div><button class="iconBtn redeem" data-id="${esc(x.reward_id)}" ${r.coin_balance<x.cost?'disabled':''}>REDEEM</button></div>`).join('')}</div><div class="sectionTitle"><h2>Recent Coin</h2></div><div class="list">${r.ledger.length?r.ledger.map(x=>`<div class="listItem"><div class="grow"><b>${esc(x.reason)}</b><div class="meta">${esc(x.created_at)}</div></div><b class="${Number(x.delta)>=0?'ok':'bad'}">${Number(x.delta)>=0?'+':''}${x.delta}</b></div>`).join(''):'<div class="small">还没有 Coin 记录。</div>'}</div><button class="btn secondary" onclick="home()">BACK TO TONIGHT</button>`);const qr=document.getElementById('playerQr');if(qr&&window.QRCode)new QRCode(qr,{text:'YTPLAYER:'+r.player.player_id,width:210,height:210,correctLevel:QRCode.CorrectLevel.M});document.querySelectorAll('.redeem').forEach(b=>b.onclick=()=>redeem(b.dataset.id))}
async function redeem(id){const r=await API.post('createRedemption',{authToken:state.authToken,rewardId:id});if(!r.ok)return toast(errorText(r.error));modal(`<div class="kicker">REDEMPTION</div><h2 class="title">给 Staff 看这个码。</h2><div class="card gold"><div class="code" style="font-size:48px;text-align:center;color:var(--gold);letter-spacing:.15em;font-weight:900">${esc(r.token)}</div><div class="small" style="text-align:center">${esc(r.reward_name||'Reward')} · 🪙 ${r.cost||''}</div></div><button class="btn secondary" onclick="closeModal()">CLOSE</button>`) }

function scanCompanion(){
  if(!window.Html5QrcodeScanner)return toast('这个浏览器暂时不能开扫码器，可直接输入 Player Code');
  modal(`<div class="kicker">SCAN PLAYER QR</div><h2 class="title">扫同行朋友的 Player QR</h2><div id="reader"></div><button class="btn secondary" onclick="closeScanner()">CANCEL</button>`);
  setTimeout(()=>{
    window._ytScanner=new Html5QrcodeScanner('reader',{fps:8,qrbox:{width:220,height:220}},false);
    window._ytScanner.render(text=>{
      const m=String(text||'').match(/YTPLAYER:(YT-P\d+)/i); if(!m)return toast('这不是 YETIPSY Player QR');
      const input=document.getElementById('companion'); if(input)input.value=m[1].toUpperCase(); closeScanner(); toast('已加入同行 Player Code');
    },()=>{});
  },50);
}
function closeScanner(){try{window._ytScanner&&window._ytScanner.clear()}catch(e){}window._ytScanner=null;closeModal()}

function modal(html){closeModal();const b=document.createElement('div');b.className='modalBackdrop';b.id='modal';b.innerHTML=`<div class="modal">${html}</div>`;document.body.appendChild(b)}function closeModal(){document.getElementById('modal')?.remove()}
init();
