# mmPlayer 在线音乐播放器 技术分析报告

> 目标站点：`https://netease-music.fe-mm.com`
> 分析日期：2026-10-01

---

## 一、站点概览

| 项目 | 详情 |
|------|------|
| **站点名称** | mmPlayer 在线音乐播放器 |
| **技术栈** | Vue 2 + Vuex + Vue Router + Axios |
| **前端仓库** | https://github.com/maomao1996/Vue-mmPlayer |
| **API 服务** | `https://netease-cloud-music-api.fe-mm.com` |
| **状态** | 已公告停止音乐在线播放服务（但页面仍可访问，API 仍返回数据） |

### 外部依赖

| 类别 | 服务 | URL |
|------|------|-----|
| 统计 | 百度统计 | `hm.baidu.com/hm.js` |
| 统计 | 51.la | `sdk.51.la/js-sdk-pro.min.js` |
| 统计 | Cloudflare Insights | `static.cloudflareinsights.com/beacon.min.js` |
| 广告 | Google AdSense | `pagead2.googlesyndication.com` |
| 访问量徽章 | visitor-badge.laobi.icu | 动态生成 |
| 字体 | 阿里 IconFont | CDN |
| 字体 | Google Fonts | `fonts.googleapis.com` |

---

## 二、前端架构分析

### 构建产物

```
index.html
├── js/
│   ├── chunk-vendors.3c04ee70.js     (第三方依赖)
│   ├── app.cd3414d5.js               (主应用 - 27KB)
│   ├── chunk-vendors-legacy.7842cc94.js
│   └── app-legacy.bab61f07.js
├── css/
│   ├── [若干样式文件]
└── bg-1.jpg, bg-2.jpg, bg-3.jpg       (背景图)
```

### 状态管理 (Vuex)

本地存储键名：

| Key | 用途 |
|-----|------|
| `__mmPlayer_historyList__` | 播放历史记录 |
| `__mmPlayer_userID__` | 用户登录 UID |
| `__mmPlayer_version__` | 版本号 |
| 音量 | 播放器音量设置 |
| 播放模式 | 顺序/随机/单曲循环 |

### 用户登录方式

- 无需密码，仅需输入**网易云音乐 UID**
- 通过 `/user/playlist?uid={uid}` 接口验证用户存在性
- UID 获取方式：登录网易云官网 → 点击头像 → URL 中 `?id=` 后的数字

---

## 三、API 端点详解

### API 基础信息

| 项目 | 详情 |
|------|------|
| **Base URL** | `https://netease-cloud-music-api.fe-mm.com` |
| **请求方式** | 全部 GET |
| **认证方式** | 无（公开代理 API） |
| **响应格式** | JSON，统一包含 `code` 字段（200 为成功） |
| **HTTP 客户端** | Axios（创建实例 `axios.create({baseURL: ...})`） |

### 前端使用的 API 端点

以下是从前端 JS bundle (`app.cd3414d5.js`) 中提取的所有实际调用的 API：

---

#### 1. 排行榜相关

##### 获取所有榜单

```
GET /toplist/detail
```

**参数：** 无

**响应示例：**
```json
{
  "code": 200,
  "list": [
    {
      "id": 19723756,
      "name": "飙升榜",
      "updateFrequency": "每小时更新",
      "coverImgUrl": "...",
      "tracks": [...]
    }
  ]
}
```

---

#### 2. 推荐歌单

##### 获取个性化推荐歌单

```
GET /personalized?limit=10
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| limit | int | 否 | 返回数量，默认10 |

**响应示例：**
```json
{
  "code": 200,
  "hasTaste": false,
  "category": 0,
  "result": [
    {
      "id": 17746603572,
      "type": 0,
      "name": "全网必听最受欢迎的网络热歌200首推荐",
      "copywriter": "",
      "picUrl": "https://p2.music.126.net/...",
      "playCount": 77480,
      "trackCount": 207,
      "highQuality": false
    }
  ]
}
```

---

#### 3. 歌单详情

##### 获取歌单详细信息及曲目

```
GET /playlist/detail?id=3778678
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | int | **是** | 歌单 ID |

**响应结构：**
```json
{
  "code": 200,
  "playlist": {
    "id": 3778678,
    "name": "热歌榜",
    "coverImgUrl": "https://p1.music.126.net/...",
    "description": "云音乐热歌榜...",
    "playCount": 14162608128,
    "trackCount": 200,
    "trackIds": [{ "id": 3439030728 }],
    "tracks": [
      {
        "id": 3439030728,
        "name": "删了一百遍",
        "ar": [{ "id": 7063, "name": "黄丽玲" }],
        "al": { "id": 399545690, "name": "联名2" },
        "dt": 247873,
        "fee": 8
      }
    ],
    "subscribers": [...]
  }
}
```

---

#### 4. 搜索

##### 搜索歌曲

```
GET /search?keywords=周杰伦&offset=0&limit=30
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keywords | string | **是** | 搜索关键词（URL 编码） |
| offset | int | 否 | 分页偏移，默认 0 |
| limit | int | 否 | 每页数量，默认 30 |

**响应示例：**
```json
{
  "result": {
    "songs": [
      {
        "id": 5257138,
        "name": "屋顶",
        "artists": [
          { "id": 6452, "name": "周杰伦" },
          { "id": 9612, "name": "温岚" }
        ],
        "album": { "id": 512175, "name": "男女情歌对唱冠军全记录" },
        "duration": 319039,
        "fee": 8
      }
    ],
    "hasMore": true,
    "songCount": 275
  },
  "code": 200
}
```

##### 热门搜索

```
GET /search/hot
```

**参数：** 无

---

#### 5. 用户歌单

##### 获取指定用户的歌单列表

```
GET /user/playlist?uid=123456
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uid | int | **是** | 网易云音乐用户 UID |

**响应示例：**
```json
{
  "code": 200,
  "playlist": [
    {
      "id": 123456789,
      "name": "我喜欢的音乐",
      "creator": { "userId": 123456, "nickname": "用户名" },
      "trackCount": 50,
      "playCount": 10000
    }
  ]
}
```

---

#### 6. 歌曲详情

##### 批量获取歌曲信息

```
GET /song/detail?ids=3439030728
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ids | string | **是** | 歌曲 ID，多个用逗号分隔 |

**响应示例：**
```json
{
  "songs": [
    {
      "id": 3439030728,
      "name": "删了一百遍",
      "ar": [{ "id": 7063, "name": "黄丽玲" }],
      "al": { "id": 399545690, "name": "联名2", "picUrl": "..." },
      "dt": 247873,
      "fee": 8
    }
  ],
  "code": 200
}
```

---

#### 7. 歌词

##### 获取歌曲歌词

```
GET /lyric?id=3439030728
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | int | **是** | 歌曲 ID |

**响应示例：**
```json
{
  "sgc": false,
  "sfy": false,
  "qfy": false,
  "lrc": {
    "version": 19,
    "lyric": "[00:00.00] 作词 : 汪苏泷\n[00:00.73] 作曲 : 汪苏泷\n..."
  },
  "klyric": { "version": 0, "lyric": "" },
  "tlyric": { "version": 0, "lyric": "" },
  "code": 200
}
```

---

#### 8. 评论

##### 获取歌曲评论

```
GET /comment/music?id=3439030728&offset=0&limit=30
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | int | **是** | 歌曲 ID |
| offset | int | 否 | 分页偏移 |
| limit | int | 否 | 每页数量 |

**响应示例：**
```json
{
  "code": 200,
  "comments": [
    {
      "user": { "nickname": "...", "avatarUrl": "..." },
      "content": "评论内容",
      "time": 1234567890
    }
  ],
  "hotComments": [],
  "moreHot": false,
  "more": true,
  "total": 1000
}
```

---

### API 完整测试清单（扩展）

以下端点**未在前端使用**，但 API 服务实际支持：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/banner?type=0` | GET | 获取首页 Banner |
| `/playlist/hot` | GET | 热门歌单分类标签 |
| `/playlist/catlist` | GET | 歌单分类列表 |
| `/personalized/djprogram?limit=N` | GET | 推荐 DJ 节目 |
| `/artist/list` | GET | 热门歌手列表 |
| `/album/list?size=N` | GET | 新碟上架 |
| `/song/url?id={id}` | GET | 获取歌曲播放地址（VIP 歌曲可能返回 null URL） |

---

## 四、音频播放机制

### 直接播放 URL

前端使用了网易云音乐的**公开音频直链**：

```
https://music.163.com/song/media/outer/url?id={songId}.mp3
```

**JS 源码片段：**
```javascript
https://music.163.com/song/media/outer/url?id=${t.id}.mp3
```

这是前端绕过 API 获取音乐播放地址的方式，直接请求网易云官方的 MP3 资源。

### 备用方案

API 也提供 `/song/url?id={id}` 端点，但部分歌曲（特别是 VIP 歌曲）的 `url` 字段会返回 `null`：

```json
{
  "code": 200,
  "data": [{
    "id": 3439030728,
    "url": null,
    "code": 404,
    "fee": 8
  }]
}
```

---

## 五、前端路由结构

从 Vue Router 配置推断的页面路由：

| 路由 | 页面 | 对应 API |
|------|------|----------|
| `/` | 首页 / 热歌榜 | `/playlist/detail?id=3778678` |
| `/music/toplist` | 排行榜 | `/toplist/detail` |
| `/music/playlist` | 歌单 | `/personalized` |
| `/music/userlist` | 我的歌单 | `/user/playlist?uid={uid}` |
| `/music/search` | 搜索 | `/search`, `/search/hot` |
| `/music/details` | 歌曲详情 | `/song/detail`, `/lyric` |
| `/music/comment` | 评论 | `/comment/music` |
| `/music/historylist` | 播放历史 | 本地存储 |

---

## 六、完整 API 汇总表

| # | 端点 | 方法 | 参数 | 前端使用 |
|---|------|------|------|:--------:|
| 1 | `/toplist/detail` | GET | 无 | ✅ |
| 2 | `/personalized` | GET | `limit` | ✅ |
| 3 | `/playlist/detail` | GET | `id` | ✅ |
| 4 | `/search` | GET | `keywords`, `offset`, `limit` | ✅ |
| 5 | `/search/hot` | GET | 无 | ✅ |
| 6 | `/user/playlist` | GET | `uid` | ✅ |
| 7 | `/song/detail` | GET | `ids`（逗号分隔） | ✅ |
| 8 | `/lyric` | GET | `id` | ✅ |
| 9 | `/comment/music` | GET | `id`, `offset`, `limit` | ✅ |
| 10 | `/banner` | GET | `type` | ❌ |
| 11 | `/playlist/hot` | GET | 无 | ❌ |
| 12 | `/playlist/catlist` | GET | 无 | ❌ |
| 13 | `/personalized/djprogram` | GET | `limit` | ❌ |
| 14 | `/artist/list` | GET | 无 | ❌ |
| 15 | `/album/list` | GET | `size` | ❌ |
| 16 | `/song/url` | GET | `id` | ❌ |

---

## 七、关键发现与总结

### 技术特点

1. **无认证 API**：所有 API 端点无需任何 Token 或 Cookie，完全公开访问
2. **纯 GET 请求**：所有接口均使用 GET 方法，参数通过 Query String 传递
3. **统一响应格式**：返回 JSON 且始终包含 `code` 字段，`200` 表示成功
4. **Vuex 集中管理**：播放器状态通过 Vuex Store 统一管理
5. **本地存储持久化**：历史记录、用户信息等通过 localStorage 保存

### API 服务性质

- 该 API 服务（`netease-cloud-music-api.fe-mm.com`）是一个**网易云音乐第三方 API 代理**
- 开源实现类似项目： [`NeteaseCloudMusicApi`](https://github.com/Binaryify/NeteaseCloudMusicApi)
- 前端仓库： [`Vue-mmPlayer`](https://github.com/maomao1996/Vue-mmPlayer)

### 已知限制

- 站点已公告停止音乐在线播放服务
- VIP 歌曲通过 `/song/url` 获取播放地址会失败（`url: null`）
- 前端尝试通过 `music.163.com/song/media/outer/url` 直接获取 MP3 资源，可能受网易云防盗链限制

### 可直接测试的 cURL 命令

```bash
# 推荐歌单
curl 'https://netease-cloud-music-api.fe-mm.com/personalized?limit=5'

# 搜索
curl 'https://netease-cloud-music-api.fe-mm.com/search?keywords=周杰伦&limit=5'

# 排行榜详情
curl 'https://netease-cloud-music-api.fe-mm.com/toplist/detail'

# 歌单详情
curl 'https://netease-cloud-music-api.fe-mm.com/playlist/detail?id=3778678'

# 歌曲详情
curl 'https://netease-cloud-music-api.fe-mm.com/song/detail?ids=3439030728'

# 歌词
curl 'https://netease-cloud-music-api.fe-mm.com/lyric?id=3439030728'

# 评论
curl 'https://netease-cloud-music-api.fe-mm.com/comment/music?id=3439030728&limit=3'
```

---

*报告完成 — 基于前端源码逆向 + 直接 API 测试*
