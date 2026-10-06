> 最新更新：请同时阅读 `README-V1.1.md`。

# YETIPSY「今晚开局」V1.0

这是一个全新项目，不依赖旧版 `yetipsy-tonight`。

## 核心原则

手机只负责：身份、分桌、隐藏任务、Challenge、Team Score、Coin、兑换。
现场游戏本身不搬进手机。

## 文件

- `index.html` + `player.js`：玩家端
- `staff.html` + `staff.js`：Staff / Host 端
- `owner.html` + `owner.js`：Owner 端
- `api.js`：Apps Script API 地址
- `styles.css`：统一 UI
- `Code.gs`：Google Apps Script 后端

---

## 1. 建立 Google Sheet 后端

1. 新建一个 Google Sheet，例如：`YETIPSY Tonight Open DB`
2. Google Sheet → 扩展程序 → Apps Script
3. 删除旧代码，把 `Code.gs` 完整贴进去
4. 保存
5. 运行 `setup()` 一次
6. 第一次会要求 Google 授权，允许即可
7. 打开 Apps Script 的 **执行日志 / Execution log**

第一次 setup 会自动：

- 创建全部数据库 Sheet
- 生成 APP SECRET
- 建立 `owner` 和 `staff` 两个初始账号
- 自动生成随机 6 位 PIN
- 写入默认隐藏任务和奖励

日志会出现类似：

```text
OWNER LOGIN -> ID: owner | PIN: 482193
STAFF LOGIN -> ID: staff | PIN: 731055
```

请先保存这两个 PIN。

如果以后忘记 Staff PIN，可以在 Apps Script 编辑器运行：

```js
resetStaffPin('staff')
```

新 PIN 会写进执行日志。

---

## 2. 部署 Apps Script Web App

Apps Script：

1. 部署 → 新建部署
2. 类型：Web app
3. Execute as：Me
4. Who has access：Anyone
5. Deploy
6. 复制 `/exec` URL

直接打开 `/exec` 应该看到类似：

```json
{
  "ok": true,
  "service": "YETIPSY Tonight Open",
  "version": "1.0.0",
  "connected": true
}
```

---

## 3. 填 API URL

打开 `api.js`：

```js
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';
```

换成你的 `/exec` URL。

---

## 4. 建立新的 GitHub repo

建议不要覆盖旧游戏。

建议 repo 名：

```text
yetipsy-tonight-open
```

上传：

```text
index.html
player.js
staff.html
staff.js
owner.html
owner.js
api.js
styles.css
```

GitHub → Settings → Pages → Deploy from branch → main / root。

之后地址大概会是：

```text
https://你的账号.github.io/yetipsy-tonight-open/
```

玩家端：

```text
/index.html
```

Staff：

```text
/staff.html
```

Owner：

```text
/owner.html
```

Staff 端生成的签到 QR 会自动指向同一个 GitHub Pages 里的 `index.html`，不需要手动改玩家 URL。

---

## 5. 第一场测试流程

### A. Owner 登录

打开 `owner.html`。

用 setup 日志里的：

```text
ID: owner
PIN: xxxxxx
```

Owner 可以：

- 查看 / 新增 / 开关隐藏任务
- 查看 / 新增 / 开关 Reward
- 添加 Staff
- Reset Staff PIN
- 人工调整 Player Coin（全部写 Ledger）

### B. Staff 开局

打开 `staff.html`。

登录后：

1. Capacity：例如 10
2. Tables：2
3. Seats / Table：5
4. OPEN SESSION

系统会建立：

```text
YT GAME #001
TABLE A
TABLE B
```

并出现会自动刷新的签到 QR。

### C. 玩家签到

玩家必须扫描 Staff QR。

第一次来：

- Nickname
- WhatsApp
- 4 位 PIN
- 可选同行 Player Code / 扫同行 Player QR

系统建立长期 Player ID：

```text
YT-P0001
```

之后自动分桌并显示 Seat，例如：

```text
TABLE A
Seat A03
```

老玩家：

- 同一手机如果长期 Auth 仍有效，扫码后可直接识别
- 换手机可使用 WhatsApp + 4 位 PIN

### D. LOCK TABLES

人齐后 Staff 点击：

```text
LOCK TABLES
```

这时系统才分发隐藏任务。

Staff 只看到 Mission Status，不看到任务内容。

### E. START GAME

Staff 点击：

```text
START GAME
```

Challenge 正式开放。

玩家可以：

- 看自己的隐藏任务
- Challenge 另一桌玩家
- 收到 Challenge 后 Accept / Pass
- 手动任务完成后 Claim，并由另一玩家 YES / NO 互证

### F. Host Table Match

Staff 后台：

- 选择 A / B 两桌代表
- 输入游戏名
- NEW TABLE MATCH
- 比赛结束后点击 A WIN / B WIN

只有这种 Host 正式比赛会改变 Team Score。

普通桌内游戏和普通 Challenge 都不记录胜负，也不加 Team Score。

### G. END SESSION

活动结束 Staff 点击：

```text
END SESSION
```

玩家 Coin 不清零，会长期保留。

---

## 数据库 Sheet

setup 会自动创建：

```text
PLAYERS
PLAYER_SESSIONS
SESSIONS
CHECKINS
TABLES
GROUPS
MISSIONS
PLAYER_MISSIONS
CHALLENGES
EVENTS
TABLE_MATCHES
COIN_LEDGER
REWARDS
REDEMPTIONS
STAFF
STAFF_SESSIONS
CONFIG
```

## 已实现的安全逻辑

- Staff 签到 QR Token 每 60 秒变化
- 上一枚 Token 保留一个短 Grace Slot
- Staff 密码不放在 QR
- Player 4 位 PIN 不明文保存
- PIN 使用 Salt + Server Secret Hash
- 连续错误 5 次会临时锁定登入
- Coin 不是直接写余额，而是全部走 `COIN_LEDGER`
- Mission Reward 有重复发放保护
- 同时签到使用 Apps Script Lock，降低重复 Player ID / 重复 Seat 的概率

## V1.0 当前边界

这是第一版“可以真实跑一场”的核心系统，刻意没有把系统做得太重。

当前 Challenge 通知：

- 玩家页面打开时会自动轮询并弹出
- 页面完全关闭 / 手机锁屏后，目前没有真正的系统 Push Notification

后续如果现场验证 Challenge 使用率高，再做 PWA Push，比一开始就增加 Firebase / Push Server 更合理。

Player QR 已经可以生成；同行签到支持扫码（浏览器允许相机权限时）或手动输入 Player Code。

---

## 建议第一场只测试这些

不要第一天就把所有 Mission 和 Reward 都开很多。

建议：

- 8–10 人
- 2 桌
- 6–8 个简单 Mission
- Mission Reward 统一 +1 Coin
- 3 个 Reward 档位
- 2–3 场 Host Table Match

先验证：

1. 签到会不会太慢
2. 自动分桌是否合理
3. 玩家是否记得看 Mission
4. Challenge 有没有人真的用
5. Peer Confirm 会不会尴尬
6. Coin 是否真的让人想下次回来

