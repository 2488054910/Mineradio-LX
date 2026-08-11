<div align="center">

# Mineradio-LX

**基于 Mineradio 的沉浸式音乐播放器 · 新增落雪音乐（LX Music）音源**

Windows 桌面沉浸式音乐播放器，融合天气电台、歌词舞台、粒子视觉、3D 歌单架与多平台音源。
本仓库为 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio) v2.1.0 的二次开发版本，遵循 **GPL-3.0** 协议。

[![GitHub release](https://img.shields.io/badge/最新版本-v2.1.1-blue)](https://github.com/2488054910/Mineradio-LX/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/2488054910/Mineradio-LX?style=social)](https://github.com/2488054910/Mineradio-LX/stargazers)
[![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blueviolet)]()

**最新版本：v2.1.1** · [⬇️ 下载安装包](https://github.com/2488054910/Mineradio-LX/releases/latest) · [📖 使用文档](#-快速开始)

</div>

---

## ✨ 项目亮点

| | 说明 |
|---|---|
| 🎵 **多平台音源** | 网易云 + QQ 音乐 + **落雪 LX 音源**（免费播放多平台曲目） |
| 🎨 **粒子视觉** | emily / 安魂 / 星河 / 唱片 / 星球 / 滚筒 / 虚空 / 泡沫 / 不规则 / 棋盘 |
| 🎬 **电影镜头** | 基于节拍的电影运镜：zoom / pan / dolly |
| 🎤 **歌词舞台** | 3D 歌词舞台、自定义字体（内置霞鹜文楷）、位置/角度/发光全可调 |
| 🌦️ **天气电台** | Open-Meteo 按天气 mood 自动生成播放队列 |
| 🗂️ **3D 歌单架** | 右键唤起，PSP 风格卡片堆叠，详情页沉浸浏览 |
| 🖥️ **桌面模式** | 动态壁纸、桌面歌词、手势控制（摄像头隔空操作） |
| 💾 **用户存档** | 视觉参数一键存档/导入导出（JSON），重装不丢配置 |

## 🆕 本版本新增（相对原版 v2.1.0）

- **落雪音源接入**：播放地址可优先从 LX 兼容音源获取，免费播放多平台曲目
- **多音源管理**：星海 / ChKSz / ikun / huibq / 野花等后端自由切换、启停
- **音质选择**：标准 128k / 高品 320k / 无损 FLAC / Hi-Res 24bit
- **内置霞鹜文楷歌词字体**：3 字重（Light / Regular / Medium），文艺质感
- **独立更新通道**：软件内更新检测指向本仓库，与原版互不干扰

---

## 🚀 快速开始

### 方式一：安装包（推荐）

从 [Releases 页面](https://github.com/2488054910/Mineradio-LX/releases/latest) 下载 `Mineradio-2.1.1-Setup.exe`，运行安装即可。

- 支持覆盖安装原版或旧版二创
- 用户数据（歌单、设置、用户存档）保存在 `%APPDATA%\Mineradio`，**升级不丢失**
- 建议升级前退出正在运行的 Mineradio

### 方式二：源码运行

```bash
npm install
npm start
```

### 方式三：打包安装包

```bash
npm run build:win        # NSIS 安装包，产物在 dist/
npm run build:win:dir    # 免安装目录版
```

---

## 📻 音源配置

音源配置保存在用户数据目录 `data/lxmusic-config.json`：

```json
{
  "enabled": true,
  "backends": [
    {
      "id": "xinghai",
      "name": "星海音源",
      "baseUrl": "https://example.com",
      "style": "xinghai",
      "keyHeader": "",
      "key": "",
      "timeoutMs": 10000,
      "qualitys": ["128k", "320k", "flac", "flac24bit"]
    }
  ],
  "selectedBackend": "xinghai"
}
```

| 字段 | 说明 |
|------|------|
| `style` | 音源协议风格：`xinghai` / `chksz` / `query` / `path` |
| `keyHeader` / `key` | 需要请求头鉴权的音源填写 |
| `qualitys` | 该音源支持的音质列表 |

> ⚠️ 部分第三方音源服务器可能不稳定，失效时可在软件内切换其他音源或停用。

---

## 🎛️ 视觉预设与用户存档

内置 10 种视觉预设，播放时自动切换歌词舞台 + 粒子同步特效：

| 预设 | 风格 |
|------|------|
| emily | 封面粒子 · 丝绸 |
| 滚筒 | 隧道 · 沉浸感 |
| 星球 | 星球 · 雕塑感 |
| 虚空 | 无粒子 · 自定义背景 |
| 唱片 | 唱片 · 圆形封面 |
| 星河 | 壁纸粒子 · 音乐律动 |
| 安魂 | 骷髅 · 哥特风 |
| 泡沫 / 不规则 / 棋盘 | 炫酷三模式（支持 5 套配色） |

**用户存档**：视觉控制台 → 用户存档，4 个槽位保存粒子/颜色/滑条/歌词外观，支持命名、导出 JSON、导入还原。社区分享的存档文件可直接导入复用。

---

## ❓ 常见问题（FAQ）

**Q: 播放提示"仅播放试听片段"？**
A: 部分平台音源限制，可切换到落雪 LX 音源或登录对应平台账号。

**Q: 封面粒子全是暗紫色？**
A: 正常现象，播放有封面的歌曲后粒子会显示封面颜色。

**Q: 低配电脑卡顿/掉帧？**
A: 视觉控制台 → 高级参数 → 画质档位调至 `低` 或 `中`，关闭浮空粒子层和电影镜头。

**Q: 安装包被杀毒软件误报？**
A: 本项目未签名，Windows Defender / 第三方杀软可能误报。可自行从源码构建，或查看 [SECURITY.md](./SECURITY.md)。

**Q: 软件内更新检测连不上 GitHub？**
A: 已内置国内镜像加速（gh.llkk.cc / ghfast.top / gh-proxy.com），网络受限时可手动下载 Release 安装包。

---

## 🤝 贡献指南

欢迎任何形式的贡献！请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

- 🐛 报告 Bug → [新建 Issue](https://github.com/2488054910/Mineradio-LX/issues/new/choose)
- 💡 功能建议 → [功能请求模板](https://github.com/2488054910/Mineradio-LX/issues/new/choose)
- 🔧 提交代码 → 先开 Issue 讨论，再提 [Pull Request](https://github.com/2488054910/Mineradio-LX/pulls)

## 📜 许可证

本项目基于 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）二次开发，遵循 **GPL-3.0** 协议。详见 [LICENSE](./LICENSE) 与 [NOTICE.md](./NOTICE.md)。

> **免责声明**：本项目非网易云音乐、QQ 音乐、腾讯音乐娱乐集团或任何音乐平台的官方客户端。音源功能仅用于个人学习与本地使用，请遵守对应平台的用户协议、版权规则和会员权益规则。项目不提供绕过付费、破解音质或重新分发音乐内容的能力。
