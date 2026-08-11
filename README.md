# Mineradio-LX

基于 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio) v2.1.0 二次开发的 Windows 沉浸式音乐播放器，新增**落雪音乐（LX Music）兼容音源**功能。

遵循 [GPL-3.0](./LICENSE) 协议。原版版权归 XxHuberrr 所有。

## 新增功能

- **落雪音源接入**：播放地址可优先从 LX 兼容音源获取，免费播放多平台曲目
- **多音源管理**：支持配置多个 LX 兼容后端（星海 / ChKSz / ikun / huibq / 野花等），可切换、启用/停用
- **音质选择**：标准 128k / 高品 320k / 无损 FLAC / Hi-Res 24bit
- **保留原版全部功能**：天气电台、粒子视觉、歌词舞台、电影镜头、3D 歌单架、网易云/QQ 音乐登录、手势控制、桌面壁纸模式等

## 快速开始

### 源码运行

```bash
npm install
npm start
```

### 安装包

见 Releases 页面下载最新安装包。

## 音源配置

音源配置保存在用户数据目录 `data/lxmusic-config.json`，格式示例：

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

- `style`：音源协议风格（`xinghai` / `chksz` / `query` / `path`）
- `keyHeader` / `key`：需要请求头鉴权的音源填写
- `qualitys`：该音源支持的音质列表

## 与原版的关系

- 上游项目：[XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）
- 本仓库为二次开发版本，独立维护与发布
- 安装过原版或旧版二创的用户，可使用本版本安装包直接覆盖升级，用户数据（歌单、设置、用户存档）保存在 `%APPDATA%\Mineradio`，不受影响

## 免责声明

- 本项目非网易云音乐、QQ 音乐、腾讯音乐娱乐集团或任何音乐平台的官方客户端
- 音源功能仅用于个人学习与本地使用，请遵守对应平台的用户协议、版权规则和会员权益规则
- 项目不提供绕过付费、破解音质或重新分发音乐内容的能力
