# YETIPSY「今晚开局」V1.3

## 这版解决什么

### 1. RETURN TO TONIGHT / 刷新慢、偶尔 timeout
- 签到成功的同一个 API 回应会直接带回 `bootstrap`（今晚完整快照）。
- Player 端立即保存到本机 localStorage。
- 以后刷新或 RETURN TO TONIGHT：先用缓存即时画出主页，再后台静默同步。
- 后台 timeout 时不再把玩家踢到空白/错误页；继续显示缓存，并把右上角状态显示为 CACHED。
- `playerHome` 改成一轮批量读取各 Sheet，不再在一个请求内重复读取同一张表。
- Player auth 使用 Apps Script CacheService；`last_seen` 最多约 5 分钟写一次，不再每 6.5 秒写 Sheet。

### 2. Challenge 抽屉慢
- `challenge_targets` 已包含在 `playerHome/bootstrap`。
- 点 CHALLENGE 直接使用已预载名单打开，不再先等待 `getChallengeTargets`。
- 抽屉打开后仍会后台静默同步最新名单。

### 3. 发 Challenge 还没 ACCEPT，Mission 就完成
- `sendChallenge` 不再触发发起者 Mission Complete。
- 发起者的自动 Challenge Mission 改为 `CHALLENGE_ACCEPTED_BY_TARGET`。
- 对方按 ACCEPT 后，发起者 Mission 才会完成。
- `M001` / `M011` 在运行 `setup()` 时自动迁移到新触发规则。

## 更新步骤

### Apps Script
1. 覆盖 `Code.gs`
2. 保存
3. **运行一次 `setup()`**（用于迁移 M001/M011 任务定义）
4. Deploy -> Manage deployments -> Edit -> New version -> Deploy
5. `/exec` 应显示 `version: 1.3.0`

### GitHub
覆盖：
- `index.html`
- `player.js`
- `styles.css`

`api.js` 没有逻辑修改。你已经填好 Apps Script URL 的话不要覆盖它。

## 测试
1. 新玩家签到：YOU'RE IN 页面应该出现 `TONIGHT READY · 已预载`。
2. 进入今晚后刷新浏览器：主页应立即出现，不再先显示 LOADING TONIGHT。
3. 从 MY PROFILE 点击 RETURN TO TONIGHT：有缓存时应几乎立即进入。
4. A 发 Challenge 给 B：A 的“主动挑战并被接受”Mission 不应完成。
5. B 按 ACCEPT：A 的 Mission 才应在随后同步时变成 COMPLETED 并加 Coin。

> 如果你当前测试 Session 里某个 Mission 已经被旧版错误判定 COMPLETED，V1.3 不会自动扣回已经发出的 Coin。建议测试时开新 Session，或手动清理那笔测试数据。
