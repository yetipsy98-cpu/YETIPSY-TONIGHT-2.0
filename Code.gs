/*
 * YETIPSY「今晚开局」Backend V1.0
 * Google Apps Script + Google Sheets
 *
 * Setup:
 * 1) Open from Google Sheet -> Extensions -> Apps Script
 * 2) Paste this file as Code.gs
 * 3) Run setup() once
 * 4) Check execution log for generated OWNER / STAFF login PINs
 * 5) Deploy as Web App: Execute as Me, access Anyone
 */

const APP_VERSION = '1.0.0';
const PROP_SHEET_ID = 'YT_OPEN_SHEET_ID';
const PROP_APP_SECRET = 'YT_OPEN_APP_SECRET';
const PLAYER_AUTH_DAYS = 180;
const STAFF_AUTH_HOURS = 12;
const QR_SLOT_MS = 60 * 1000;
const QR_GRACE_SLOTS = 1;
const LOGIN_LOCK_MIN = 10;
const MAX_LOGIN_FAILS = 5;

const SCHEMA = {
  PLAYERS: ['player_id','nickname','phone','pin_hash','salt','created_at','last_login','status','lifetime_sessions','failed_login_count','locked_until'],
  PLAYER_SESSIONS: ['auth_token','player_id','device_id','expires_at','created_at','last_seen'],
  SESSIONS: ['session_id','game_no','session_date','status','capacity','table_count','table_size','start_time','hidden_mission_enabled','coin_enabled','leaderboard_enabled','auto_assign','created_at','opened_at','locked_at','started_at','ended_at'],
  CHECKINS: ['session_id','player_id','checked_in_at','table_id','seat_code','group_id','status'],
  TABLES: ['session_id','table_id','capacity','score','status'],
  GROUPS: ['session_id','group_id','created_by','member_ids','policy'],
  MISSIONS: ['mission_id','title','type','description','reward_coin','trigger_event','verification','active','rule_json'],
  PLAYER_MISSIONS: ['session_id','player_id','mission_id','status','assigned_at','claim_target_player_id','claim_status','claim_at','completed_at','rewarded_at'],
  CHALLENGES: ['challenge_id','session_id','from_player_id','to_player_id','game','status','created_at','responded_at','expires_at'],
  EVENTS: ['event_id','session_id','event_type','actor_player_id','target_player_id','table_id','metadata_json','created_at','staff_id'],
  TABLE_MATCHES: ['match_id','session_id','table_a','table_b','player_a','player_b','game','winner_table','status','created_at','completed_at','staff_id'],
  COIN_LEDGER: ['ledger_id','player_id','session_id','delta','reason','ref_type','ref_id','created_at','staff_id'],
  REWARDS: ['reward_id','name','cost','active','description'],
  REDEMPTIONS: ['redemption_id','player_id','reward_id','cost','status','token','created_at','confirmed_at','staff_id'],
  STAFF: ['staff_id','name','pin_hash','salt','role','active','created_at'],
  STAFF_SESSIONS: ['auth_token','staff_id','expires_at','created_at','last_seen'],
  CONFIG: ['key','value']
};

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('请从 Google Sheet -> 扩展程序 -> Apps Script 打开。');
  PropertiesService.getScriptProperties().setProperty(PROP_SHEET_ID, ss.getId());
  if (!PropertiesService.getScriptProperties().getProperty(PROP_APP_SECRET)) {
    PropertiesService.getScriptProperties().setProperty(PROP_APP_SECRET, Utilities.getUuid() + Utilities.getUuid());
  }
  Object.keys(SCHEMA).forEach(name => ensureSheet_(ss, name, SCHEMA[name]));
  seedConfig_(ss);
  seedMissions_(ss);
  seedRewards_(ss);
  const creds = seedInitialStaff_(ss);
  SpreadsheetApp.flush();
  Logger.log('YETIPSY 今晚开局 V' + APP_VERSION + ' setup complete.');
  if (creds.ownerPin) Logger.log('OWNER LOGIN -> ID: owner | PIN: ' + creds.ownerPin);
  if (creds.staffPin) Logger.log('STAFF LOGIN -> ID: staff | PIN: ' + creds.staffPin);
  return {ok:true, version:APP_VERSION, spreadsheet:ss.getName(), credentials_created:!!(creds.ownerPin || creds.staffPin)};
}

function resetStaffPin(staffId) {
  const ss = getDB_();
  const sh = ss.getSheetByName('STAFF');
  const row = findRow_(sh, 'staff_id', String(staffId || '').trim());
  if (!row) throw new Error('staff_not_found');
  const pin = randomDigits_(6);
  const salt = Utilities.getUuid();
  updateRow_(sh, row._row, {pin_hash:hashPin_(pin, salt), salt:salt});
  Logger.log('NEW PIN -> ' + staffId + ': ' + pin);
  return pin;
}

function doGet() {
  try {
    const ss = getDB_();
    return json_({ok:true, service:'YETIPSY Tonight Open', version:APP_VERSION, database:ss.getName(), connected:true});
  } catch (e) {
    return json_({ok:false, version:APP_VERSION, connected:false, error:String(e.message || e)});
  }
}

function doPost(e) {
  try {
    const data = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = String(data.action || '');
    const ss = getDB_();
    const map = {
      validateJoin: validateJoin_,
      registerAndCheckIn: registerAndCheckIn_,
      loginAndCheckIn: loginAndCheckIn_,
      resumeAndCheckIn: resumeAndCheckIn_,
      playerHome: playerHome_,
      playerProfile: playerProfile_,
      claimMission: claimMission_,
      confirmMissionClaim: confirmMissionClaim_,
      getChallengeTargets: getChallengeTargets_,
      sendChallenge: sendChallenge_,
      respondChallenge: respondChallenge_,
      createRedemption: createRedemption_,

      staffLogin: staffLogin_,
      staffDashboard: staffDashboard_,
      createSession: createSession_,
      getCheckinToken: getCheckinToken_,
      movePlayer: movePlayer_,
      lockTables: lockTables_,
      startGame: startGame_,
      endSession: endSession_,
      recordStagePlayer: recordStagePlayer_,
      createTableMatch: createTableMatch_,
      finishTableMatch: finishTableMatch_,
      confirmRedemption: confirmRedemption_,

      ownerOverview: ownerOverview_,
      saveMission: saveMission_,
      toggleMission: toggleMission_,
      saveReward: saveReward_,
      toggleReward: toggleReward_,
      addStaff: addStaff_,
      ownerResetStaffPin: ownerResetStaffPin_,
      adjustCoin: adjustCoin_,
      saveConfig: saveConfig_
    };
    if (!map[action]) return json_({ok:false,error:'unknown_action',action:action});
    return json_(map[action](ss, data));
  } catch (e) {
    console.error(e);
    return json_({ok:false,error:String(e.message || e)});
  }
}

// ------------------------- Player join/auth -------------------------

function validateJoin_(ss, d) {
  const session = getSession_(ss, d.sessionId);
  if (!session) return {ok:false,error:'session_not_found'};
  if (session.status !== 'CHECK_IN') return {ok:false,error:'session_closed'};
  if (!verifyQrToken_(session.session_id, d.token)) return {ok:false,error:'qr_expired'};
  const count = getCheckins_(ss, session.session_id).filter(x => x.status === 'ACTIVE').length;
  return {ok:true, session:publicSession_(session), checked_in:count, full:count >= Number(session.capacity)};
}

function registerAndCheckIn_(ss, d) {
  const gate = validateJoin_(ss, d);
  if (!gate.ok) return gate;
  const nickname = clean_(d.nickname, 24);
  const phone = normalizePhone_(d.phone);
  const pin = String(d.pin || '').trim();
  if (!nickname || !phone || !/^\d{4}$/.test(pin)) return {ok:false,error:'invalid_registration'};
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    if (findRow_(ss.getSheetByName('PLAYERS'), 'phone', phone)) return {ok:false,error:'phone_exists'};
    const playerId = nextPlayerId_(ss);
    const salt = Utilities.getUuid();
    appendObj_(ss.getSheetByName('PLAYERS'), {
      player_id:playerId,nickname:nickname,phone:phone,pin_hash:hashPin_(pin,salt),salt:salt,
      created_at:new Date(),last_login:new Date(),status:'ACTIVE',lifetime_sessions:0,failed_login_count:0,locked_until:''
    });
    const auth = issuePlayerAuth_(ss, playerId, clean_(d.deviceId, 120));
    const checkin = checkInPlayer_(ss, gate.session.session_id, playerId, d.companionCode, true);
    return {ok:true, auth_token:auth, player_id:playerId, checkin:checkin};
  } finally { lock.releaseLock(); }
}

function loginAndCheckIn_(ss, d) {
  const gate = validateJoin_(ss, d);
  if (!gate.ok) return gate;
  const phone = normalizePhone_(d.phone);
  const pin = String(d.pin || '').trim();
  const sh = ss.getSheetByName('PLAYERS');
  const p = findRow_(sh,'phone',phone);
  if (!p) return {ok:false,error:'login_failed'};
  if (p.locked_until && new Date(p.locked_until).getTime() > Date.now()) return {ok:false,error:'login_locked'};
  if (p.pin_hash !== hashPin_(pin,p.salt)) {
    const n = Number(p.failed_login_count || 0) + 1;
    updateRow_(sh,p._row,{failed_login_count:n,locked_until:n>=MAX_LOGIN_FAILS?new Date(Date.now()+LOGIN_LOCK_MIN*60000):''});
    return {ok:false,error:n>=MAX_LOGIN_FAILS?'login_locked':'login_failed'};
  }
  updateRow_(sh,p._row,{failed_login_count:0,locked_until:'',last_login:new Date()});
  const auth = issuePlayerAuth_(ss,p.player_id,clean_(d.deviceId,120));
  const checkin = checkInPlayer_(ss, gate.session.session_id, p.player_id, d.companionCode);
  return {ok:true,auth_token:auth,player_id:p.player_id,checkin:checkin};
}

function resumeAndCheckIn_(ss, d) {
  const gate = validateJoin_(ss,d);
  if (!gate.ok) return gate;
  const auth = requirePlayer_(ss,d.authToken);
  const checkin = checkInPlayer_(ss,gate.session.session_id,auth.player_id,d.companionCode);
  return {ok:true,player_id:auth.player_id,checkin:checkin};
}

function playerHome_(ss, d) {
  const auth = requirePlayer_(ss,d.authToken);
  const player = findRow_(ss.getSheetByName('PLAYERS'),'player_id',auth.player_id);
  const session = getSession_(ss,d.sessionId) || getLatestPlayerSession_(ss,auth.player_id);
  if (!session) return {ok:true,player:publicPlayer_(player),session:null};
  const ci = findCheckin_(ss,session.session_id,auth.player_id);
  if (!ci) return {ok:true,player:publicPlayer_(player),session:publicSession_(session),checked_in:false};
  const mission = getPlayerMissionView_(ss,session.session_id,auth.player_id);
  const balance = coinBalance_(ss,auth.player_id);
  const scores = getScores_(ss,session.session_id);
  const incoming = getIncomingChallenge_(ss,session.session_id,auth.player_id);
  const claimRequest = getPendingClaimRequest_(ss,session.session_id,auth.player_id);
  return {
    ok:true, player:publicPlayer_(player), session:publicSession_(session), checked_in:true,
    table_id:ci.table_id, seat_code:ci.seat_code, mission:mission, coin_balance:balance,
    scores:scores, incoming_challenge:incoming, mission_confirmation:claimRequest
  };
}

function playerProfile_(ss,d) {
  const auth = requirePlayer_(ss,d.authToken);
  const p = findRow_(ss.getSheetByName('PLAYERS'),'player_id',auth.player_id);
  const ledger = rows_(ss.getSheetByName('COIN_LEDGER')).filter(x=>x.player_id===auth.player_id).slice(-30).reverse();
  const missions = rows_(ss.getSheetByName('PLAYER_MISSIONS')).filter(x=>x.player_id===auth.player_id && x.status==='COMPLETED').length;
  const challenges = rows_(ss.getSheetByName('CHALLENGES')).filter(x=>x.from_player_id===auth.player_id || x.to_player_id===auth.player_id).length;
  const rewards = rows_(ss.getSheetByName('REWARDS')).filter(x=>bool_(x.active)).map(r=>({reward_id:r.reward_id,name:r.name,cost:Number(r.cost),description:r.description}));
  return {ok:true,player:publicPlayer_(p),coin_balance:coinBalance_(ss,auth.player_id),missions_completed:missions,challenges:challenges,ledger:ledger,rewards:rewards};
}

// ------------------------- Sessions/tables/check-in -------------------------

function createSession_(ss,d) {
  const staff = requireStaff_(ss,d.authToken,['OWNER','STAFF']);
  const active = rows_(ss.getSheetByName('SESSIONS')).find(x=>['CHECK_IN','TABLES_LOCKED','LIVE'].includes(x.status));
  if (active) return {ok:false,error:'active_session_exists',session:publicSession_(active)};
  const capacity = clamp_(Number(d.capacity)||10,2,100);
  const tableCount = clamp_(Number(d.tableCount)||2,1,12);
  const tableSize = clamp_(Number(d.tableSize)||Math.ceil(capacity/tableCount),1,20);
  const gameNo = nextGameNo_(ss);
  const sid = 'YT-' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'Asia/Kuala_Lumpur','yyyyMMdd') + '-' + String(gameNo).padStart(3,'0');
  const now = new Date();
  appendObj_(ss.getSheetByName('SESSIONS'),{
    session_id:sid,game_no:gameNo,session_date:now,status:'CHECK_IN',capacity:capacity,table_count:tableCount,table_size:tableSize,
    start_time:clean_(d.startTime,16),hidden_mission_enabled:d.hiddenMissionEnabled!==false,coin_enabled:d.coinEnabled!==false,
    leaderboard_enabled:d.leaderboardEnabled!==false,auto_assign:d.autoAssign!==false,created_at:now,opened_at:now,locked_at:'',started_at:'',ended_at:''
  });
  const tsh = ss.getSheetByName('TABLES');
  for(let i=0;i<tableCount;i++) appendObj_(tsh,{session_id:sid,table_id:tableName_(i),capacity:tableSize,score:0,status:'OPEN'});
  logEvent_(ss,sid,'SESSION_OPEN','','','',{},staff.staff_id);
  return {ok:true,session:publicSession_(getSession_(ss,sid))};
}

function getCheckinToken_(ss,d) {
  requireStaff_(ss,d.authToken,['OWNER','STAFF']);
  const session = getSession_(ss,d.sessionId);
  if (!session || session.status!=='CHECK_IN') return {ok:false,error:'session_not_checkin'};
  const slot = Math.floor(Date.now()/QR_SLOT_MS);
  return {ok:true,session_id:session.session_id,token:qrToken_(session.session_id,slot),expires_in_ms:QR_SLOT_MS-(Date.now()%QR_SLOT_MS)};
}

function checkInPlayer_(ss, sessionId, playerId, companionCode, lockHeld) {
  if (!lockHeld) {
    const lock = LockService.getScriptLock();
    lock.waitLock(8000);
    try { return checkInPlayer_(ss, sessionId, playerId, companionCode, true); }
    finally { lock.releaseLock(); }
  }
  const session = getSession_(ss,sessionId);
  if (!session || session.status!=='CHECK_IN') throw new Error('checkin_closed');
  let ci = findCheckin_(ss,sessionId,playerId);
  if (ci) return {session_id:sessionId,table_id:ci.table_id,seat_code:ci.seat_code,already_checked_in:true};
  const activeCount = getCheckins_(ss,sessionId).filter(x=>x.status==='ACTIVE').length;
  if (activeCount >= Number(session.capacity)) throw new Error('session_full');

  let groupId='';
  let companionCi=null;
  const code = clean_(companionCode,20).toUpperCase();
  if (code) {
    const companion = findRow_(ss.getSheetByName('PLAYERS'),'player_id',normalizePlayerCode_(code));
    if (companion) companionCi=findCheckin_(ss,sessionId,companion.player_id);
    if (companionCi) {
      groupId = companionCi.group_id || ('G-'+Utilities.getUuid().slice(0,8).toUpperCase());
      if (!companionCi.group_id) updateCheckin_(ss,companionCi._row,{group_id:groupId});
      upsertGroup_(ss,sessionId,groupId,playerId,companionCi.player_id);
    }
  }

  const tableId = assignTable_(ss,session,groupId,companionCi);
  const seatCode = nextSeat_(ss,sessionId,tableId);
  appendObj_(ss.getSheetByName('CHECKINS'),{session_id:sessionId,player_id:playerId,checked_in_at:new Date(),table_id:tableId,seat_code:seatCode,group_id:groupId,status:'ACTIVE'});
  logEvent_(ss,sessionId,'CHECK_IN',playerId,'',tableId,{seat:seatCode},'SYSTEM');
  return {session_id:sessionId,table_id:tableId,seat_code:seatCode,already_checked_in:false};
}

function assignTable_(ss,session,groupId,companionCi) {
  const tables = rows_(ss.getSheetByName('TABLES')).filter(x=>x.session_id===session.session_id && x.status==='OPEN');
  const checkins = getCheckins_(ss,session.session_id).filter(x=>x.status==='ACTIVE');
  const counts={}; tables.forEach(t=>counts[t.table_id]=0); checkins.forEach(c=>counts[c.table_id]=(counts[c.table_id]||0)+1);
  if (groupId && companionCi) {
    const groupMembers = checkins.filter(x=>x.group_id===groupId).length + 1;
    if (groupMembers <= 2 && counts[companionCi.table_id] < Number((tables.find(t=>t.table_id===companionCi.table_id)||{}).capacity||session.table_size)) return companionCi.table_id;
  }
  tables.sort((a,b)=>(counts[a.table_id]||0)-(counts[b.table_id]||0) || String(a.table_id).localeCompare(String(b.table_id)));
  const chosen = tables.find(t=>(counts[t.table_id]||0)<Number(t.capacity));
  if (!chosen) throw new Error('no_table_capacity');
  return chosen.table_id;
}

function movePlayer_(ss,d) {
  const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);
  const session=getSession_(ss,d.sessionId); if(!session) return {ok:false,error:'session_not_found'};
  const ci=findCheckin_(ss,session.session_id,d.playerId); if(!ci) return {ok:false,error:'player_not_checked_in'};
  const target=clean_(d.tableId,8).toUpperCase();
  const table=rows_(ss.getSheetByName('TABLES')).find(x=>x.session_id===session.session_id && x.table_id===target); if(!table) return {ok:false,error:'table_not_found'};
  const count=getCheckins_(ss,session.session_id).filter(x=>x.status==='ACTIVE'&&x.table_id===target&&x.player_id!==ci.player_id).length;
  if(count>=Number(table.capacity)&&!d.force) return {ok:false,error:'table_full'};
  const old=ci.table_id; const seat=nextSeat_(ss,session.session_id,target,ci.player_id);
  updateCheckin_(ss,ci._row,{table_id:target,seat_code:seat});
  logEvent_(ss,session.session_id,'TABLE_MOVE',ci.player_id,'',target,{from:old,to:target},staff.staff_id);
  checkMissionEvent_(ss,session.session_id,ci.player_id,'TABLE_MOVE',{from:old,to:target});
  return {ok:true,table_id:target,seat_code:seat};
}

function lockTables_(ss,d) {
  const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);
  const session=getSession_(ss,d.sessionId); if(!session || session.status!=='CHECK_IN') return {ok:false,error:'invalid_session_state'};
  updateSession_(ss,session._row,{status:'TABLES_LOCKED',locked_at:new Date()});
  if(bool_(session.hidden_mission_enabled)) assignMissions_(ss,session.session_id);
  logEvent_(ss,session.session_id,'TABLES_LOCKED','','','',{},staff.staff_id);
  return {ok:true};
}

function startGame_(ss,d) {
  const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);
  const session=getSession_(ss,d.sessionId); if(!session || !['TABLES_LOCKED','LIVE'].includes(session.status)) return {ok:false,error:'invalid_session_state'};
  updateSession_(ss,session._row,{status:'LIVE',started_at:session.started_at||new Date()});
  logEvent_(ss,session.session_id,'SESSION_START','','','',{},staff.staff_id);
  return {ok:true};
}

function endSession_(ss,d) {
  const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);
  const session=getSession_(ss,d.sessionId); if(!session || session.status==='ENDED') return {ok:false,error:'invalid_session_state'};
  updateSession_(ss,session._row,{status:'ENDED',ended_at:new Date()});
  const psh=ss.getSheetByName('PLAYERS');
  getCheckins_(ss,session.session_id).filter(x=>x.status==='ACTIVE').forEach(ci=>{
    const p=findRow_(psh,'player_id',ci.player_id); if(p) updateRow_(psh,p._row,{lifetime_sessions:Number(p.lifetime_sessions||0)+1});
  });
  logEvent_(ss,session.session_id,'SESSION_END','','','',{},staff.staff_id);
  return {ok:true,scores:getScores_(ss,session.session_id)};
}

// ------------------------- Missions -------------------------

function assignMissions_(ss,sessionId) {
  const active = rows_(ss.getSheetByName('MISSIONS')).filter(x=>bool_(x.active));
  if (!active.length) return;
  const msh=ss.getSheetByName('PLAYER_MISSIONS');
  const existing=rows_(msh).filter(x=>x.session_id===sessionId);
  getCheckins_(ss,sessionId).filter(x=>x.status==='ACTIVE').forEach((ci,idx)=>{
    if(existing.some(x=>x.player_id===ci.player_id)) return;
    const m=active[(idx + Math.floor(Math.random()*active.length)) % active.length];
    appendObj_(msh,{session_id:sessionId,player_id:ci.player_id,mission_id:m.mission_id,status:'ACTIVE',assigned_at:new Date(),claim_target_player_id:'',claim_status:'',claim_at:'',completed_at:'',rewarded_at:''});
  });
}

function getPlayerMissionView_(ss,sessionId,playerId) {
  const pm=rows_(ss.getSheetByName('PLAYER_MISSIONS')).find(x=>x.session_id===sessionId&&x.player_id===playerId); if(!pm) return null;
  const m=findRow_(ss.getSheetByName('MISSIONS'),'mission_id',pm.mission_id); if(!m) return null;
  return {mission_id:m.mission_id,title:m.title,description:m.description,reward_coin:Number(m.reward_coin||0),type:m.type,verification:m.verification,status:pm.status,claim_status:pm.claim_status};
}

function checkMissionEvent_(ss,sessionId,playerId,eventType,meta) {
  const pm=rows_(ss.getSheetByName('PLAYER_MISSIONS')).find(x=>x.session_id===sessionId&&x.player_id===playerId&&x.status==='ACTIVE');
  if(!pm) return;
  const m=findRow_(ss.getSheetByName('MISSIONS'),'mission_id',pm.mission_id); if(!m||m.verification!=='AUTO'||m.trigger_event!==eventType) return;
  completeMission_(ss,pm,m,'SYSTEM',meta);
}

function claimMission_(ss,d) {
  const auth=requirePlayer_(ss,d.authToken);
  const pm=rows_(ss.getSheetByName('PLAYER_MISSIONS')).find(x=>x.session_id===d.sessionId&&x.player_id===auth.player_id&&x.status==='ACTIVE');
  if(!pm) return {ok:false,error:'mission_not_active'};
  const m=findRow_(ss.getSheetByName('MISSIONS'),'mission_id',pm.mission_id); if(!m) return {ok:false,error:'mission_not_found'};
  if(m.verification!=='PEER') return {ok:false,error:'mission_auto_verified'};
  const target=normalizePlayerCode_(d.targetPlayerId); if(!target||target===auth.player_id) return {ok:false,error:'invalid_target'};
  if(!findCheckin_(ss,d.sessionId,target)) return {ok:false,error:'target_not_in_session'};
  let rule={}; try{rule=m.rule_json?JSON.parse(m.rule_json):{}}catch(e){}
  if(rule.different_table){const mine=findCheckin_(ss,d.sessionId,auth.player_id),theirs=findCheckin_(ss,d.sessionId,target);if(mine&&theirs&&mine.table_id===theirs.table_id)return {ok:false,error:'target_must_be_other_table'};}
  updatePlayerMission_(ss,pm._row,{status:'CLAIM_PENDING',claim_target_player_id:target,claim_status:'PENDING',claim_at:new Date()});
  return {ok:true};
}

function getPendingClaimRequest_(ss,sessionId,targetPlayerId) {
  const pm=rows_(ss.getSheetByName('PLAYER_MISSIONS')).find(x=>x.session_id===sessionId&&x.claim_target_player_id===targetPlayerId&&x.status==='CLAIM_PENDING'&&x.claim_status==='PENDING');
  if(!pm) return null;
  const p=findRow_(ss.getSheetByName('PLAYERS'),'player_id',pm.player_id);
  return {from_player_id:pm.player_id,from_nickname:p?p.nickname:pm.player_id};
}

function confirmMissionClaim_(ss,d) {
  const auth=requirePlayer_(ss,d.authToken);
  const pm=rows_(ss.getSheetByName('PLAYER_MISSIONS')).find(x=>x.session_id===d.sessionId&&x.player_id===normalizePlayerCode_(d.fromPlayerId)&&x.claim_target_player_id===auth.player_id&&x.status==='CLAIM_PENDING'&&x.claim_status==='PENDING');
  if(!pm) return {ok:false,error:'claim_not_found'};
  if(!d.approve) {updatePlayerMission_(ss,pm._row,{status:'ACTIVE',claim_target_player_id:'',claim_status:'REJECTED'});return {ok:true,approved:false};}
  const m=findRow_(ss.getSheetByName('MISSIONS'),'mission_id',pm.mission_id); completeMission_(ss,pm,m,'PEER:'+auth.player_id,{}); return {ok:true,approved:true};
}

function completeMission_(ss,pm,m,staffId,meta) {
  updatePlayerMission_(ss,pm._row,{status:'COMPLETED',claim_status:pm.claim_status||'',completed_at:new Date(),rewarded_at:new Date()});
  const reward=Number(m.reward_coin||0);
  if(reward) addCoin_(ss,pm.player_id,pm.session_id,reward,'Mission Complete','MISSION',pm.session_id+'|'+m.mission_id,staffId||'SYSTEM');
  logEvent_(ss,pm.session_id,'MISSION_COMPLETE',pm.player_id,'','',{mission_id:m.mission_id,meta:meta||{}},staffId||'SYSTEM');
}

// ------------------------- Challenge -------------------------

function getChallengeTargets_(ss,d) {
  const auth=requirePlayer_(ss,d.authToken); const ci=findCheckin_(ss,d.sessionId,auth.player_id); if(!ci) return {ok:false,error:'not_checked_in'};
  const players=rows_(ss.getSheetByName('PLAYERS')); const map={};players.forEach(p=>map[p.player_id]=p.nickname);
  const targets=getCheckins_(ss,d.sessionId).filter(x=>x.status==='ACTIVE'&&x.player_id!==auth.player_id&&x.table_id!==ci.table_id).map(x=>({player_id:x.player_id,nickname:map[x.player_id]||x.player_id,table_id:x.table_id}));
  return {ok:true,targets:targets};
}

function sendChallenge_(ss,d) {
  const auth=requirePlayer_(ss,d.authToken); const session=getSession_(ss,d.sessionId); if(!session||session.status!=='LIVE') return {ok:false,error:'game_not_live'};
  const fromCi=findCheckin_(ss,d.sessionId,auth.player_id); const toId=normalizePlayerCode_(d.toPlayerId); const toCi=findCheckin_(ss,d.sessionId,toId);
  if(!fromCi||!toCi||fromCi.table_id===toCi.table_id) return {ok:false,error:'invalid_target'};
  const active=rows_(ss.getSheetByName('CHALLENGES')).find(x=>x.session_id===d.sessionId&&x.from_player_id===auth.player_id&&x.status==='PENDING'&&new Date(x.expires_at).getTime()>Date.now());
  if(active) return {ok:false,error:'challenge_pending'};
  const id='CH-'+Utilities.getUuid().slice(0,8).toUpperCase();
  appendObj_(ss.getSheetByName('CHALLENGES'),{challenge_id:id,session_id:d.sessionId,from_player_id:auth.player_id,to_player_id:toId,game:clean_(d.game,40),status:'PENDING',created_at:new Date(),responded_at:'',expires_at:new Date(Date.now()+3*60000)});
  logEvent_(ss,d.sessionId,'CHALLENGE_SENT',auth.player_id,toId,fromCi.table_id,{game:d.game},'SYSTEM');
  checkMissionEvent_(ss,d.sessionId,auth.player_id,'CHALLENGE_SENT',{target:toId});
  checkMissionEvent_(ss,d.sessionId,toId,'CHALLENGE_RECEIVED',{from:auth.player_id});
  return {ok:true,challenge_id:id};
}

function getIncomingChallenge_(ss,sessionId,playerId) {
  const c=rows_(ss.getSheetByName('CHALLENGES')).filter(x=>x.session_id===sessionId&&x.to_player_id===playerId&&x.status==='PENDING'&&new Date(x.expires_at).getTime()>Date.now()).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
  if(!c) return null; const p=findRow_(ss.getSheetByName('PLAYERS'),'player_id',c.from_player_id); const ci=findCheckin_(ss,sessionId,c.from_player_id);
  return {challenge_id:c.challenge_id,from_player_id:c.from_player_id,from_nickname:p?p.nickname:c.from_player_id,from_table:ci?ci.table_id:'',game:c.game,expires_at:c.expires_at};
}

function respondChallenge_(ss,d) {
  const auth=requirePlayer_(ss,d.authToken); const sh=ss.getSheetByName('CHALLENGES'); const c=findRow_(sh,'challenge_id',d.challengeId); if(!c||c.to_player_id!==auth.player_id||c.status!=='PENDING') return {ok:false,error:'challenge_not_found'};
  const status=d.accept?'ACCEPTED':'PASSED'; updateRow_(sh,c._row,{status:status,responded_at:new Date()});
  if(d.accept){logEvent_(ss,c.session_id,'CHALLENGE_ACCEPTED',c.from_player_id,c.to_player_id,'',{game:c.game},'SYSTEM');checkMissionEvent_(ss,c.session_id,c.from_player_id,'CHALLENGE_ACCEPTED_BY_TARGET',{target:c.to_player_id});checkMissionEvent_(ss,c.session_id,c.to_player_id,'CHALLENGE_ACCEPTED_TARGET',{from:c.from_player_id});}
  return {ok:true,status:status};
}

// ------------------------- Host events/table matches -------------------------

function recordStagePlayer_(ss,d){const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);const pid=normalizePlayerCode_(d.playerId);if(!findCheckin_(ss,d.sessionId,pid))return{ok:false,error:'player_not_in_session'};logEvent_(ss,d.sessionId,'STAGE_JOIN',pid,'','',{},staff.staff_id);checkMissionEvent_(ss,d.sessionId,pid,'STAGE_JOIN',{});return{ok:true};}

function createTableMatch_(ss,d){const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);const session=getSession_(ss,d.sessionId);if(!session||session.status!=='LIVE')return{ok:false,error:'game_not_live'};const id='TM-'+Utilities.getUuid().slice(0,8).toUpperCase();appendObj_(ss.getSheetByName('TABLE_MATCHES'),{match_id:id,session_id:d.sessionId,table_a:clean_(d.tableA,8).toUpperCase(),table_b:clean_(d.tableB,8).toUpperCase(),player_a:normalizePlayerCode_(d.playerA),player_b:normalizePlayerCode_(d.playerB),game:clean_(d.game,50),winner_table:'',status:'ACTIVE',created_at:new Date(),completed_at:'',staff_id:staff.staff_id});return{ok:true,match_id:id};}

function finishTableMatch_(ss,d){const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);const sh=ss.getSheetByName('TABLE_MATCHES');const m=findRow_(sh,'match_id',d.matchId);if(!m||m.status!=='ACTIVE')return{ok:false,error:'match_not_found'};const winner=clean_(d.winnerTable,8).toUpperCase();if(![m.table_a,m.table_b].includes(winner))return{ok:false,error:'invalid_winner'};updateRow_(sh,m._row,{winner_table:winner,status:'DONE',completed_at:new Date()});const tsh=ss.getSheetByName('TABLES');const tr=rows_(tsh).find(x=>x.session_id===m.session_id&&x.table_id===winner);if(tr)updateRow_(tsh,tr._row,{score:Number(tr.score||0)+1});[m.player_a,m.player_b].filter(Boolean).forEach(pid=>{logEvent_(ss,m.session_id,'CROSS_TABLE_GAME',pid,'',findCheckin_(ss,m.session_id,pid)?.table_id||'',{match_id:m.match_id,winner:winner},staff.staff_id);checkMissionEvent_(ss,m.session_id,pid,'CROSS_TABLE_GAME',{match_id:m.match_id,winner:winner});});return{ok:true,scores:getScores_(ss,m.session_id)};}

// ------------------------- Coin / reward -------------------------

function createRedemption_(ss,d){const auth=requirePlayer_(ss,d.authToken);const reward=findRow_(ss.getSheetByName('REWARDS'),'reward_id',d.rewardId);if(!reward||!bool_(reward.active))return{ok:false,error:'reward_not_found'};const cost=Number(reward.cost||0);if(coinBalance_(ss,auth.player_id)<cost)return{ok:false,error:'insufficient_coin'};const pending=rows_(ss.getSheetByName('REDEMPTIONS')).find(x=>x.player_id===auth.player_id&&x.status==='PENDING');if(pending)return{ok:true,redemption_id:pending.redemption_id,token:pending.token};const id='RD-'+Utilities.getUuid().slice(0,8).toUpperCase();const token=randomDigits_(6);appendObj_(ss.getSheetByName('REDEMPTIONS'),{redemption_id:id,player_id:auth.player_id,reward_id:reward.reward_id,cost:cost,status:'PENDING',token:token,created_at:new Date(),confirmed_at:'',staff_id:''});return{ok:true,redemption_id:id,token:token,reward_name:reward.name,cost:cost};}

function confirmRedemption_(ss,d){const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);const sh=ss.getSheetByName('REDEMPTIONS');const r=rows_(sh).find(x=>x.token===String(d.token||'').trim()&&x.status==='PENDING');if(!r)return{ok:false,error:'redemption_not_found'};if(coinBalance_(ss,r.player_id)<Number(r.cost))return{ok:false,error:'insufficient_coin'};updateRow_(sh,r._row,{status:'CONFIRMED',confirmed_at:new Date(),staff_id:staff.staff_id});addCoin_(ss,r.player_id,'',-Number(r.cost),'Reward Redemption','REDEMPTION',r.redemption_id,staff.staff_id);return{ok:true,player_id:r.player_id,cost:Number(r.cost)};}

function addCoin_(ss,playerId,sessionId,delta,reason,refType,refId,staffId){const sh=ss.getSheetByName('COIN_LEDGER');const dup=rows_(sh).find(x=>x.ref_type===refType&&x.ref_id===refId&&x.player_id===playerId&&Number(x.delta)===Number(delta));if(dup)return false;appendObj_(sh,{ledger_id:'CL-'+Utilities.getUuid().slice(0,10).toUpperCase(),player_id:playerId,session_id:sessionId||'',delta:Number(delta),reason:reason,ref_type:refType,ref_id:refId,created_at:new Date(),staff_id:staffId||'SYSTEM'});return true;}
function coinBalance_(ss,playerId){return rows_(ss.getSheetByName('COIN_LEDGER')).filter(x=>x.player_id===playerId).reduce((s,x)=>s+Number(x.delta||0),0);}

// ------------------------- Staff/owner -------------------------

function staffLogin_(ss,d){const id=clean_(d.staffId,30).toLowerCase();const pin=String(d.pin||'').trim();const s=findRow_(ss.getSheetByName('STAFF'),'staff_id',id);if(!s||!bool_(s.active)||s.pin_hash!==hashPin_(pin,s.salt))return{ok:false,error:'login_failed'};const token=Utilities.getUuid()+Utilities.getUuid();appendObj_(ss.getSheetByName('STAFF_SESSIONS'),{auth_token:token,staff_id:s.staff_id,expires_at:new Date(Date.now()+STAFF_AUTH_HOURS*3600000),created_at:new Date(),last_seen:new Date()});return{ok:true,auth_token:token,staff:{staff_id:s.staff_id,name:s.name,role:s.role}};}

function staffDashboard_(ss,d){const staff=requireStaff_(ss,d.authToken,['OWNER','STAFF']);let session=d.sessionId?getSession_(ss,d.sessionId):rows_(ss.getSheetByName('SESSIONS')).filter(x=>['CHECK_IN','TABLES_LOCKED','LIVE'].includes(x.status)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;if(!session)return{ok:true,staff:staff,session:null};const players=rows_(ss.getSheetByName('PLAYERS'));const pmap={};players.forEach(p=>pmap[p.player_id]=p);const checkins=getCheckins_(ss,session.session_id).filter(x=>x.status==='ACTIVE').map(ci=>{const p=pmap[ci.player_id]||{};const pm=getPlayerMissionView_(ss,session.session_id,ci.player_id);return{player_id:ci.player_id,nickname:p.nickname||ci.player_id,table_id:ci.table_id,seat_code:ci.seat_code,group_id:ci.group_id,mission_status:pm?pm.status:'NONE'};});const tables=rows_(ss.getSheetByName('TABLES')).filter(x=>x.session_id===session.session_id).map(t=>({table_id:t.table_id,capacity:Number(t.capacity),score:Number(t.score||0),players:checkins.filter(c=>c.table_id===t.table_id)}));const activeMatches=rows_(ss.getSheetByName('TABLE_MATCHES')).filter(x=>x.session_id===session.session_id&&x.status==='ACTIVE');return{ok:true,staff:staff,session:publicSession_(session),tables:tables,checkin_count:checkins.length,active_matches:activeMatches};}

function ownerOverview_(ss,d){const owner=requireStaff_(ss,d.authToken,['OWNER']);return{ok:true,owner:owner,missions:rows_(ss.getSheetByName('MISSIONS')),rewards:rows_(ss.getSheetByName('REWARDS')),staff:rows_(ss.getSheetByName('STAFF')).map(x=>({staff_id:x.staff_id,name:x.name,role:x.role,active:bool_(x.active)})),config:rows_(ss.getSheetByName('CONFIG')),recent_sessions:rows_(ss.getSheetByName('SESSIONS')).slice(-20).reverse()};}
function saveMission_(ss,d){requireStaff_(ss,d.authToken,['OWNER']);const sh=ss.getSheetByName('MISSIONS');const id=clean_(d.missionId,30)||('M-'+Utilities.getUuid().slice(0,8).toUpperCase());const row=findRow_(sh,'mission_id',id);const obj={mission_id:id,title:clean_(d.title,60),type:clean_(d.type,20)||'A',description:clean_(d.description,240),reward_coin:Number(d.rewardCoin||1),trigger_event:clean_(d.triggerEvent,40),verification:clean_(d.verification,20)||'AUTO',active:d.active!==false,rule_json:clean_(d.ruleJson,500)};if(row)updateRow_(sh,row._row,obj);else appendObj_(sh,obj);return{ok:true,mission_id:id};}
function toggleMission_(ss,d){requireStaff_(ss,d.authToken,['OWNER']);const sh=ss.getSheetByName('MISSIONS');const r=findRow_(sh,'mission_id',d.missionId);if(!r)return{ok:false,error:'mission_not_found'};updateRow_(sh,r._row,{active:!!d.active});return{ok:true};}
function saveReward_(ss,d){requireStaff_(ss,d.authToken,['OWNER']);const sh=ss.getSheetByName('REWARDS');const id=clean_(d.rewardId,30)||('R-'+Utilities.getUuid().slice(0,8).toUpperCase());const row=findRow_(sh,'reward_id',id);const obj={reward_id:id,name:clean_(d.name,80),cost:Number(d.cost||1),active:d.active!==false,description:clean_(d.description,180)};if(row)updateRow_(sh,row._row,obj);else appendObj_(sh,obj);return{ok:true,reward_id:id};}
function toggleReward_(ss,d){requireStaff_(ss,d.authToken,['OWNER']);const sh=ss.getSheetByName('REWARDS');const r=findRow_(sh,'reward_id',d.rewardId);if(!r)return{ok:false,error:'reward_not_found'};updateRow_(sh,r._row,{active:!!d.active});return{ok:true};}
function addStaff_(ss,d){requireStaff_(ss,d.authToken,['OWNER']);const id=clean_(d.staffId,30).toLowerCase();if(!id)return{ok:false,error:'invalid_staff_id'};const sh=ss.getSheetByName('STAFF');if(findRow_(sh,'staff_id',id))return{ok:false,error:'staff_exists'};const pin=randomDigits_(6),salt=Utilities.getUuid();appendObj_(sh,{staff_id:id,name:clean_(d.name,50)||id,pin_hash:hashPin_(pin,salt),salt:salt,role:d.role==='OWNER'?'OWNER':'STAFF',active:true,created_at:new Date()});return{ok:true,staff_id:id,temporary_pin:pin};}
function ownerResetStaffPin_(ss,d){requireStaff_(ss,d.authToken,['OWNER']);const sh=ss.getSheetByName('STAFF');const r=findRow_(sh,'staff_id',clean_(d.staffId,30).toLowerCase());if(!r)return{ok:false,error:'staff_not_found'};const pin=randomDigits_(6),salt=Utilities.getUuid();updateRow_(sh,r._row,{pin_hash:hashPin_(pin,salt),salt:salt});return{ok:true,temporary_pin:pin};}
function adjustCoin_(ss,d){const owner=requireStaff_(ss,d.authToken,['OWNER']);const pid=normalizePlayerCode_(d.playerId);if(!findRow_(ss.getSheetByName('PLAYERS'),'player_id',pid))return{ok:false,error:'player_not_found'};const delta=Number(d.delta||0);if(!delta)return{ok:false,error:'invalid_delta'};addCoin_(ss,pid,d.sessionId||'',delta,clean_(d.reason,120)||'Owner adjustment','ADJUSTMENT',Utilities.getUuid(),owner.staff_id);return{ok:true,balance:coinBalance_(ss,pid)};}
function saveConfig_(ss,d){requireStaff_(ss,d.authToken,['OWNER']);setConfig_(ss,clean_(d.key,80),clean_(d.value,300));return{ok:true};}

// ------------------------- Helpers -------------------------

function getDB_(){const id=PropertiesService.getScriptProperties().getProperty(PROP_SHEET_ID);if(!id)throw new Error('请先运行 setup()');return SpreadsheetApp.openById(id);}
function ensureSheet_(ss,name,headers){let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);}else{const current=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0];headers.forEach((h,i)=>{if(current[i]!==h)sh.getRange(1,i+1).setValue(h);});}return sh;}
function headers_(sh){return sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);}
function rows_(sh){if(sh.getLastRow()<2)return[];const h=headers_(sh);return sh.getRange(2,1,sh.getLastRow()-1,h.length).getValues().map((r,i)=>{const o={_row:i+2};h.forEach((k,j)=>o[k]=r[j]);return o;});}
function appendObj_(sh,obj){const h=headers_(sh);sh.appendRow(h.map(k=>obj[k]!==undefined?obj[k]:''));}
function updateRow_(sh,row,obj){const h=headers_(sh);Object.keys(obj).forEach(k=>{const i=h.indexOf(k);if(i>=0)sh.getRange(row,i+1).setValue(obj[k]);});}
function findRow_(sh,key,val){return rows_(sh).find(x=>String(x[key])===String(val))||null;}
function getSession_(ss,id){if(!id)return null;return findRow_(ss.getSheetByName('SESSIONS'),'session_id',String(id));}
function updateSession_(ss,row,obj){updateRow_(ss.getSheetByName('SESSIONS'),row,obj);}
function getCheckins_(ss,sid){return rows_(ss.getSheetByName('CHECKINS')).filter(x=>x.session_id===sid);}
function findCheckin_(ss,sid,pid){return rows_(ss.getSheetByName('CHECKINS')).find(x=>x.session_id===sid&&x.player_id===pid)||null;}
function updateCheckin_(ss,row,obj){updateRow_(ss.getSheetByName('CHECKINS'),row,obj);}
function updatePlayerMission_(ss,row,obj){updateRow_(ss.getSheetByName('PLAYER_MISSIONS'),row,obj);}
function getLatestPlayerSession_(ss,pid){const all=rows_(ss.getSheetByName('CHECKINS')).filter(x=>x.player_id===pid);if(!all.length)return null;const sessions=all.map(ci=>getSession_(ss,ci.session_id)).filter(Boolean).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));return sessions[0]||null;}
function publicSession_(s){return{session_id:s.session_id,game_no:Number(s.game_no),status:s.status,capacity:Number(s.capacity),table_count:Number(s.table_count),table_size:Number(s.table_size),start_time:s.start_time,session_date:s.session_date};}
function publicPlayer_(p){return{player_id:p.player_id,nickname:p.nickname,lifetime_sessions:Number(p.lifetime_sessions||0)};}
function getScores_(ss,sid){return rows_(ss.getSheetByName('TABLES')).filter(x=>x.session_id===sid).map(x=>({table_id:x.table_id,score:Number(x.score||0)}));}
function nextSeat_(ss,sid,tableId,excludePid){const used=new Set(getCheckins_(ss,sid).filter(x=>x.status==='ACTIVE'&&x.table_id===tableId&&x.player_id!==excludePid).map(x=>String(x.seat_code).replace(/^.*?(\d+)$/,'$1')).map(Number));let n=1;while(used.has(n))n++;return tableId+String(n).padStart(2,'0');}
function tableName_(i){return i<26?String.fromCharCode(65+i):'T'+(i+1);}
function nextGameNo_(ss){const nums=rows_(ss.getSheetByName('SESSIONS')).map(x=>Number(x.game_no)||0);return(nums.length?Math.max.apply(null,nums):0)+1;}
function nextPlayerId_(ss){const nums=rows_(ss.getSheetByName('PLAYERS')).map(x=>Number(String(x.player_id||'').replace(/\D/g,''))||0);return'YT-P'+String((nums.length?Math.max.apply(null,nums):0)+1).padStart(4,'0');}
function normalizePlayerCode_(v){let s=String(v||'').trim().toUpperCase();if(/^P\d+$/.test(s))s='YT-'+s;return s;}
function normalizePhone_(v){return String(v||'').replace(/[^0-9]/g,'').slice(0,20);}
function clean_(v,n){return String(v===undefined||v===null?'':v).replace(/[<>]/g,'').trim().slice(0,n||100);}
function bool_(v){return v===true||String(v).toLowerCase()==='true'||String(v)==='1';}
function clamp_(n,min,max){return Math.max(min,Math.min(max,n));}
function randomDigits_(n){let s='';for(let i=0;i<n;i++)s+=Math.floor(Math.random()*10);return s;}
function hashPin_(pin,salt){const secret=PropertiesService.getScriptProperties().getProperty(PROP_APP_SECRET)||'';const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(pin)+'|'+String(salt)+'|'+secret);return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'');}
function issuePlayerAuth_(ss,pid,deviceId){const token=Utilities.getUuid()+Utilities.getUuid();appendObj_(ss.getSheetByName('PLAYER_SESSIONS'),{auth_token:token,player_id:pid,device_id:deviceId,expires_at:new Date(Date.now()+PLAYER_AUTH_DAYS*86400000),created_at:new Date(),last_seen:new Date()});return token;}
function requirePlayer_(ss,token){const sh=ss.getSheetByName('PLAYER_SESSIONS');const a=findRow_(sh,'auth_token',String(token||''));if(!a||new Date(a.expires_at).getTime()<Date.now())throw new Error('player_auth_required');updateRow_(sh,a._row,{last_seen:new Date()});return a;}
function requireStaff_(ss,token,roles){const sh=ss.getSheetByName('STAFF_SESSIONS');const a=findRow_(sh,'auth_token',String(token||''));if(!a||new Date(a.expires_at).getTime()<Date.now())throw new Error('staff_auth_required');const staff=findRow_(ss.getSheetByName('STAFF'),'staff_id',a.staff_id);if(!staff||!bool_(staff.active)||roles.indexOf(String(staff.role))<0)throw new Error('staff_forbidden');updateRow_(sh,a._row,{last_seen:new Date()});return{staff_id:staff.staff_id,name:staff.name,role:staff.role};}
function qrToken_(sid,slot){const secret=PropertiesService.getScriptProperties().getProperty(PROP_APP_SECRET)||'';const bytes=Utilities.computeHmacSha256Signature(sid+'|'+slot,secret);return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'').slice(0,22);}
function verifyQrToken_(sid,token){const slot=Math.floor(Date.now()/QR_SLOT_MS);for(let i=0;i<=QR_GRACE_SLOTS;i++){if(qrToken_(sid,slot-i)===String(token||''))return true;}return false;}
function upsertGroup_(ss,sid,gid,pid,companionPid){const sh=ss.getSheetByName('GROUPS');let g=rows_(sh).find(x=>x.session_id===sid&&x.group_id===gid);let ids=[];if(g)ids=String(g.member_ids||'').split(',').filter(Boolean);[pid,companionPid].forEach(x=>{if(x&&!ids.includes(x))ids.push(x);});if(g)updateRow_(sh,g._row,{member_ids:ids.join(',')});else appendObj_(sh,{session_id:sid,group_id:gid,created_by:pid,member_ids:ids.join(','),policy:'PAIR_TOGETHER_SPLIT_3PLUS'});}
function logEvent_(ss,sid,type,actor,target,table,meta,staff){appendObj_(ss.getSheetByName('EVENTS'),{event_id:'EV-'+Utilities.getUuid().slice(0,10).toUpperCase(),session_id:sid,event_type:type,actor_player_id:actor||'',target_player_id:target||'',table_id:table||'',metadata_json:JSON.stringify(meta||{}),created_at:new Date(),staff_id:staff||'SYSTEM'});}
function setConfig_(ss,key,value){const sh=ss.getSheetByName('CONFIG');const r=findRow_(sh,'key',key);if(r)updateRow_(sh,r._row,{value:value});else appendObj_(sh,{key:key,value:value});}
function seedConfig_(ss){const defaults={BRAND_NAME:'YETIPSY 今晚开局',DEFAULT_CAPACITY:'10',DEFAULT_TABLE_COUNT:'2',DEFAULT_TABLE_SIZE:'5',GROUP_POLICY:'PAIR_TOGETHER_SPLIT_3PLUS',QR_REFRESH_SECONDS:'60',QR_GRACE_SECONDS:'60'};Object.keys(defaults).forEach(k=>{if(!findRow_(ss.getSheetByName('CONFIG'),'key',k))appendObj_(ss.getSheetByName('CONFIG'),{key:k,value:defaults[k]});});}
function seedInitialStaff_(ss){const sh=ss.getSheetByName('STAFF');const out={};if(!findRow_(sh,'staff_id','owner')){out.ownerPin=randomDigits_(6);let salt=Utilities.getUuid();appendObj_(sh,{staff_id:'owner',name:'Owner',pin_hash:hashPin_(out.ownerPin,salt),salt:salt,role:'OWNER',active:true,created_at:new Date()});}if(!findRow_(sh,'staff_id','staff')){out.staffPin=randomDigits_(6);let salt=Utilities.getUuid();appendObj_(sh,{staff_id:'staff',name:'Staff',pin_hash:hashPin_(out.staffPin,salt),salt:salt,role:'STAFF',active:true,created_at:new Date()});}return out;}
function seedMissions_(ss){const sh=ss.getSheetByName('MISSIONS');if(sh.getLastRow()>1)return;[
['M001','主动出击','A','今晚主动挑战另一桌的一位玩家。',1,'CHALLENGE_SENT','AUTO'],
['M002','有人找你','C','让另一桌的一位玩家主动向你发起挑战。',1,'CHALLENGE_RECEIVED','AUTO'],
['M003','上场一次','A','参加一次 Host 宣布的舞台互动。',1,'STAGE_JOIN','AUTO'],
['M004','跨桌代表','A','代表你的桌参加一次正式跨桌比赛。',1,'CROSS_TABLE_GAME','AUTO'],
['M005','换个位置','A','今晚被 Staff 调整桌位一次。',1,'TABLE_MOVE','AUTO'],
['M006','第一次认识','B','跟今晚第一次认识的人完成一局现场互动。',1,'','PEER'],
['M007','说上三句话','B','跟另一桌的一位玩家聊到至少三句话。',1,'','PEER','{"different_table":true}'],
['M008','一起玩一局','B','跟另一桌的一位玩家完整玩一局现场小游戏。',1,'','PEER','{"different_table":true}'],
['M009','互相记住名字','B','跟另一桌的一位玩家互相记住对方名字。',1,'','PEER','{"different_table":true}'],
['M010','主动接受','A','接受一次另一桌玩家的 Challenge。',1,'CHALLENGE_ACCEPTED_TARGET','AUTO'],
['M011','发出邀请','A','向另一桌发出一次 Challenge。',1,'CHALLENGE_SENT','AUTO'],
['M012','跨桌出现','A','参加一次跨桌活动。',1,'CROSS_TABLE_GAME','AUTO']
].forEach(x=>appendObj_(sh,{mission_id:x[0],title:x[1],type:x[2],description:x[3],reward_coin:x[4],trigger_event:x[5],verification:x[6],active:true,rule_json:x[7]||''}));}
function seedRewards_(ss){const sh=ss.getSheetByName('REWARDS');if(sh.getLastRow()>1)return;[['R005','5 Coin Reward',5,'小奖励，由现场Staff说明。'],['R010','10 Coin Reward',10,'指定兑换奖励。'],['R020','20 Coin Special',20,'Special Reward。']].forEach(x=>appendObj_(sh,{reward_id:x[0],name:x[1],cost:x[2],active:true,description:x[3]}));}
function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
