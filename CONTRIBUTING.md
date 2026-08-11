# 贡献指南

感谢你对 Mineradio-LX 的关注！任何形式的贡献都受欢迎：报告 Bug、提功能建议、提交代码、完善文档。

## 目录

- [贡献方式](#贡献方式)
- [开发环境](#开发环境)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [发布流程](#发布流程)

## 贡献方式

### 🐛 报告 Bug

1. 先搜索 [已有 Issue](https://github.com/2488054910/Mineradio-LX/issues)，避免重复
2. 使用 [Bug 报告模板](https://github.com/2488054910/Mineradio-LX/issues/new/choose) 创建 Issue
3. 尽量包含：版本号、操作系统、复现步骤、截图/日志

### 💡 功能建议

使用 [功能请求模板](https://github.com/2488054910/Mineradio-LX/issues/new/choose)，说明场景和预期效果。

### 🔧 提交代码

1. 先开 Issue 讨论方案（避免白做）
2. Fork 本仓库并创建功能分支
3. 开发并自测
4. 提交 Pull Request

## 开发环境

- Node.js 20+
- Windows 10/11（本项目主平台）

```bash
npm install        # 安装依赖
npm start          # 开发运行（Electron）
npm run build:win  # 打包安装包
```

## 代码规范

- 保持现有代码风格（本项目为原生 JS，模块化组织在 `public/js/modules/`）
- 修改前先阅读相关模块，遵循既有模式
- 不引入不必要的新依赖
- 涉及 `server.js` 的改动需同步检查前端调用
- 新增音源/API 时补充错误处理和回退逻辑

## 提交规范

提交信息使用以下格式：

```
<type>: <简短描述>

[详细说明（可选）]
```

type 类型：

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `docs` | 文档 |
| `style` | 格式调整 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `chore` | 构建/工具链 |

示例：

```
feat: 新增 XX 音源支持

- 支持 XXX 协议
- 补充错误回退
```

## Pull Request 流程

1. PR 标题遵循提交规范
2. PR 描述中说明：改动内容、测试情况、相关 Issue
3. 确保 CI 检查通过（语法检查 + 冒烟测试）
4. 维护者 review 后会合并

## 发布流程

1. 更新 `CHANGELOG.md`
2. 提升 `package.json` 版本号
3. 构建：`npm run build:win`
4. 创建 GitHub Release：上传 `dist/` 下的安装包、blockmap、latest.yml
5. 在 Release 说明中列出变更

## 行为准则

参与本项目即表示同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。
