# YETIPSY「今晚开局」V1.1

## 本版解决的问题

1. **刷新后可直接回到游戏**
   - 成功签到后会立即移除 URL 里的临时 `sid/token`。
   - 后续刷新使用长期 Player auth，不会再拿过期二维码重新签到。

2. **玩家状态自动同步，不整页刷新**
   - 活动进行中约每 6.5 秒同步一次。
   - 自动更新：Session 状态、桌号/Seat、Coin、Team Score、Mission 状态、Challenge、互证请求。
   - 页面保持不动，只更新必要区域。

3. **Challenge 通知**
   - 玩家可点击 `ENABLE CHALLENGE ALERTS` 授权浏览器通知。
   - 页面存在（前台或后台）时，新 Challenge 会触发：通知、震动（支持设备）、提示音和抽屉。
   - 完全关闭浏览器后，当前 GitHub Pages + Apps Script 架构无法保证真正 Push；这需要后续接 Web Push / FCM。

4. **抽屉式操作**
   - Mission / Challenge / Profile / 互证 / Redemption 全部使用底部 Drawer。
   - 不再为了看一个功能把整个主页面替换掉。

5. **Profile 可在家查看**
   - 没有 Staff QR 也可以点击 `MY PROFILE`。
   - 使用 WhatsApp + 4-digit PIN 登录。
   - 可查看长期 Coin、Player QR、奖励、近期 Coin Ledger。
   - 如果当晚已经签到，会出现 `RETURN TO TONIGHT`。

6. **Staff QR 更稳定**
   - QR 只在实际 Token 轮换时才重画（约每 60 秒）。
   - 页面上的倒计时每秒更新，但 QR 图本身不会每 20 秒闪一下。
   - Staff Dashboard 每约 6 秒局部刷新人数和桌位，不重画整页。

## 部署

### Apps Script
覆盖 `Code.gs` 后：
1. 保存。
2. 不需要新增 Sheet；现有 V1.0 数据结构兼容。
3. `Deploy -> Manage deployments -> Edit -> New version -> Deploy`。
4. `/exec` 应显示 `version: 1.1.0`。

### GitHub Pages
覆盖：
- `index.html`
- `player.js`
- `staff.html`
- `staff.js`
- `styles.css`
- 新增 `sw.js`

`owner.html` 只是更新静态资源版本号，Owner 逻辑未改。

### api.js
**如果你已经填写了 Apps Script `/exec` URL，不要用包里的 placeholder 覆盖你现有的 `api.js`。**
本版 API 地址没有变化。

## 建议测试

### 测试 A：刷新恢复
1. Staff 开 Session。
2. Player 扫 QR 签到。
3. 进入 Tonight 首页。
4. 刷新浏览器。
5. 应直接回到 Tonight，不要求重新扫码。

### 测试 B：自动状态
1. Player 保持首页。
2. Staff `LOCK TABLES`。
3. 玩家无需刷新，几秒内 Mission 应自动出现。
4. Staff `START GAME`，Challenge 按钮自动可用。

### 测试 C：Challenge 通知
1. 两台玩家手机分别在不同桌。
2. 接收方先点击 `ENABLE CHALLENGE ALERTS`。
3. 手机 A 向手机 B 发 Challenge。
4. B 页面几秒内应自动弹出 Challenge Drawer；授权通知后，后台标签页也会收到浏览器通知。
5. B ACCEPT 后，A 会自动收到 Accepted 更新。

### 测试 D：Staff QR
1. 打开 Staff CHECK_IN 页面。
2. QR 应保持稳定，不会每次人数刷新都闪动。
3. 只有 Token 到期时才换二维码。
