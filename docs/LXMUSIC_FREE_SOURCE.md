# 免费音源功能说明

## 概述

Mineradio 新增了一项"免费音源"功能。当一首歌因为 VIP、付费、试听或版权限制无法播放时,软件会自动尝试通过第三方音源接口解析出一个可播放的直链地址并直接播放,同时在界面显示"免费"角标。

这里的"音源接口"指的是第三方音源 API 服务器。它们的工作方式是:接收一个平台歌曲标识(网易云 id、QQ songmid、酷狗 hash 等),返回一个可以直接播放的音频链接。Mineradio 本身保留了原有的搜索功能,这些音源接口只用于"把已有的歌曲 ID 换成可播放链接",不提供搜索能力。因此搜索仍然通过 Mineradio 内置的网易云、QQ、酷狗等平台完成,免费音源只在播放环节介入。

默认预置了两个音源后端(可在设置中增删和开关)。全部改动只影响本机安装目录,原有文件已备份。

## 工作原理

整体流程如下:

1. 搜索阶段:通过 Mineradio 内置的网易云、QQ、酷狗、汽水、Spotify 等平台搜索歌曲,得到带有平台歌曲 ID 的搜索结果。
2. 播放失败判定:当某首歌因为以下限制无法播放时触发免费换源:
   - vip_required(需要 VIP)
   - paid_required(需要付费或购买)
   - trial_only(仅返回试听片段)
   - copyright_unavailable(版权限制)
   - url_unavailable(未返回可播放地址)
3. 触发免费换源:前端调用 tryLxMusicFreeFallback,向服务端发送 POST/GET /api/lxmusic/resolve 请求,携带歌曲的平台、ID、歌名、歌手、时长和期望音质。
4. 音源解析:服务端根据歌曲来源做直接映射或交叉匹配:
   - 网易云歌曲:直接用网易云 id 请求音源(wy 源)
   - QQ 歌曲:直接用 songmid 请求音源(tx 源)
   - 酷狗歌曲:直接用 hash 请求音源(kg 源)
   - 汽水/Spotify 歌曲:先在网易云、QQ、酷狗三个平台按歌名和歌手搜索,然后严格匹配歌名(归一化后相等)、歌手(至少一个 token 重叠)、时长(差不超过 10 秒)。匹配成功才用匹配到的平台 ID 去请求音源;匹配不严格则放弃,绝不播错歌。
5. 多后端故障切换:按配置中的后端顺序依次尝试,某个后端返回错误码(被封、限流)或网络失败时自动切到下一个。
6. 代理播放:解析成功后,音频通过 /api/audio 代理播放,不直接暴露第三方链接。
7. 界面提示:播放成功后显示"免费音源播放"通知,并在播放控件旁显示"免费"角标,附带实际播放音质。

## 配置说明

在用户弹窗中新增了"免费音源"设置页签,可以管理音源后端。

### 后端列表

每一行显示一个后端的信息:

- 名称:后端的显示名
- 网址:音源 API 的基础地址
- 请求风格:query(参数拼在 URL 查询串)或 path(参数拼在 URL 路径中)
- 密钥:显示为掩码(不暴露原文),请求时通过指定的 Header 发送
- 支持的音质:该后端声明可用的音质列表
- 启用开关:可以单独启用或禁用某个后端
- 删除按钮:移除该后端
- 连通状态:显示最近一次请求的结果,如果失败会显示 lastError(最后一次错误信息)

### 新增后端

填写名称、网址、请求风格(query 或 path)、密钥 Header 名、密钥值,勾选支持的音质,保存即可。

### 默认预置后端

- ikun 音源:https://api.ikunshare.com,query 风格,Header 为 X-Request-Key,公开密钥 public_source,支持 128k、320k、flac、flac24bit
- Huibq 音源:https://lxmusicapi.onrender.com,path 风格,Header 为 X-Request-Key,公开密钥 share-v3,支持 128k、320k

### 音质映射

Mineradio 的音质偏好会映射到音源接口支持的音质:

| Mineradio 音质 | 映射到音源音质 |
| --- | --- |
| 标准 | 128k |
| 高 | 320k |
| 无损 | flac |
| 臻音 | flac24bit |

如果后端不支持请求的音质,会自动降到该后端支持的最高音质,角标会显示实际播放的音质。

### 设置面板中的免责声明

设置面板中包含一行免责声明文字,提醒免费音源来自第三方接口、仅供个人试听、可能失效或被限流。(该声明由设置面板功能添加,参见任务 8。)

## 故障排查

设置面板中每个后端都会显示 lastError(最后一次错误信息),方便定位问题。

常见问题:

- 接口全部不可达(网络错误或被封):软件会自动跳过免费换源,回到原有的跳过或切换逻辑,不会卡住或报错。
- 解析返回占位链接:服务端有校验器,如果返回的链接看起来像占位符(例如包含"无法获取播放链接"等错误信息),会拒绝该结果并尝试下一个后端。
- 缓存的链接失效:如果之前缓存的链接播放失败,会自动带 nocache 参数重试一次,绕过缓存。
- 第三方接口随时可能失效或限流:多后端故障切换机制可以在一个后端不可用时自动使用其他后端。

如果所有后端都不可用,软件会正常走原有的播放失败处理流程(提示需要会员或跳过),不会有任何异常。

## 免责声明

免费音源功能依赖的第三方接口(如 ikunshare、onrender 等)属于未授权的音源服务,仅供个人本地试听使用,处于灰色地带。这些接口可能随时失效、限流或封禁 IP。

Mineradio 官方项目本身不提供绕过付费或版权限制的能力。本功能是个人在本地安装目录中的修改,不代表官方立场,也不与任何音源接口或音乐平台存在合作关系。

使用本功能时,请遵守相关音乐平台和服务的条款与法律法规。如果你支持某位艺人或作品,请通过正规渠道购买或订阅。

## 回滚与更新

### 恢复方法

所有被修改的原文件都已备份在 resources/app/.backup-original/ 目录中。要回滚到修改前的状态,只需将备份目录中的对应文件复制回原位,然后重启软件即可。

被备份的文件清单:

- server.js
- public/index.html
- public/js/index-loader.js
- public/js/modules/00-state/00-core-stores.js
- public/js/modules/05-playback/00-api-quality-output.js
- public/js/modules/05-playback/07-search.js
- public/js/modules/05-playback/11-provider-fallback.js
- public/js/modules/05-playback/13-playback-start-audio.js
- public/js/modules/08-account/01-login-modal-utils.js
- public/js/modules/08-account/02-login-status.js
- public/js/modules/08-account/03-login-modal-flows.js
- public/js/modules/08-account/04-user-modal-logout.js

此外,新增的文件(不影响回滚,但如需完全清除可以手动删除):

- lxmusic-api.js(服务端音源模块)
- public/js/modules/05-playback/15-lxmusic-free-source.js(前端免费换源模块)
- data/lxmusic-config.json(音源后端配置文件)
- docs/LXMUSIC_FREE_SOURCE.md(本文档)

### 更新提醒

Mineradio 应用内的更新功能只会打开浏览器跳转到下载页,不会自动覆盖本地文件。但如果日后安装了新版本的安装包,安装包会覆盖 resources/app 目录下的所有文件,届时本功能会失效。

如果新版安装包发布后仍需要本功能,需要重新执行本计划的修改步骤(备份文件仍然存在,可以作为参考)。

本文档不修改应用原有的 README、LICENSE 或 NOTICE 文件。
