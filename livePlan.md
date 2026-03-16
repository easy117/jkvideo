# B站直播详情页 实现计划

## Context
现有应用已有直播列表（LiveCard + useLiveList），但点击卡片只是用 `Linking.openURL` 跳转到外部浏览器，没有应用内直播详情页。本次目标是实现一个完整的 in-app 直播详情页，包括 HLS 播放器、主播信息、房间简介。

---

## 直播详情页功能需求（MVP）

| 功能 | 说明 |
|---|---|
| 直播播放器 | HLS (m3u8) 流，`react-native-video` 播放，支持全屏 |
| 房间信息 | 标题、分类（父/子分区）、在线人数 |
| 主播信息 | 头像、昵称 |
| 关注按钮 | 展示样式，不调 API（bili_jct 不在当前登录流程中） |
| 离线状态 | 若 `live_status !== 1` 或无流 URL，显示"暂未开播" |

**跳过（Post-MVP）：** 实时弹幕WebSocket、质量切换、送礼、直播间聊天

---

## Bilibili 直播 API

| 函数 | 接口 | 说明 |
|---|---|---|
| `getLiveRoomDetail(roomId)` | `LIVE_BASE/room/v1/Room/get_info` | 房间详情（标题、分区、live_status、在线人数） |
| `getLiveAnchorInfo(roomId)` | `LIVE_BASE/live_user/v1/UserInfo/get_anchor_in_room` | 主播信息（uid、uname、face） |
| `getLiveStreamUrl(roomId)` | `LIVE_BASE/xlive/web-room/v2/index/getRoomPlayInfo` | 获取 HLS/FLV 流 URL |

**流 URL 提取路径：**
```
data.playurl_info.playurl.stream[]
  → protocol_name === 'http_hls'
  → format[].format_name === 'fmp4' or 'ts'
  → codec[].codec_name === 'avc'
  → url_info[0].host + codec.base_url
```

---

## 文件变更清单（按依赖顺序）

### 新增文件
1. `livePlan.md` — 本文件
2. `services/types.ts` — 添加 `LiveRoomDetail`、`LiveAnchorInfo`、`LiveStreamInfo` 类型
3. `services/bilibili.ts` — 添加 `getLiveRoomDetail`、`getLiveAnchorInfo`、`getLiveStreamUrl`
4. `hooks/useLiveDetail.ts` — 直播详情 hook（并行拉取房间信息+主播信息）
5. `components/LivePlayer.tsx` — 直播播放器（web 提示 / native 用 react-native-video HLS）
6. `app/live/_layout.tsx` — Stack layout（同 `app/video/_layout.tsx`）
7. `app/live/[roomId].tsx` — 直播详情页主文件

### 修改文件
8. `dev-proxy.js` — 添加 `/bilibili-live` 代理路由（修复 web 端直播 API）
9. `app/_layout.tsx` — 注册 `live` Stack.Screen（动画同 video）
10. `app/index.tsx` — 替换 `Linking.openURL` 为 `router.push('/live/...')`，给直播 tab 的卡片加 `onPress`

---

## 组件结构

```
app/live/[roomId].tsx
  TopBar (返回 + 标题)
  LivePlayer
    ├── web: "请在手机端观看直播"
    └── native: <Video source={{uri: hlsUrl}} /> + 简单控制栏 (LIVE 标牌 / 全屏)
  ScrollView
    房间标题
    在线人数 + LivePulse
    分区标签 (parent_area_name > area_name)
    分割线
    主播行 (头像 + uname + 关注按钮)
    房间描述文本
```

---

## 数据流

```
LiveCard onPress → router.push('/live/[roomId]')
  useLiveDetail(roomId)
    Promise.all([getLiveRoomDetail, getLiveAnchorInfo])
    if live_status===1 → getLiveStreamUrl → hlsUrl
      → LivePlayer <Video source={{uri: hlsUrl}} />
```

---

## 注意事项

1. **`roomId` 类型**：`useLocalSearchParams` 返回 string，需 `parseInt(roomId, 10)`
2. **router.push 类型**：使用 `as any` 规避 TypeScript 动态路由报错
3. **流 URL 提取**：用可选链 (`?.`) 兜底，失败时返回 `{ hlsUrl: '', flvUrl: '', qn: 0 }`，让 LivePlayer 显示离线状态
4. **live 无 onEnd**：直播流没有结束，不处理 `onEnd` 事件
5. **web 端 HLS**：`<video>` 标签仅 Safari 原生支持 m3u8，Chrome 不支持；web 端显示提示文字即可

---

## 验证方式

1. `expo start` → 扫码打开 → 首页直播 tab → 点击直播卡片 → 进入详情页
2. 验证：播放器加载 → 视频流开始缓冲 → 显示主播信息与房间标题
3. 验证：点击全屏 → 横屏全屏播放
4. 验证：关闭直播间（或选一个离线房间）→ 显示"暂未开播"占位图
5. web 端：`expo start --web` → 直播详情页显示"请在手机端观看直播"
