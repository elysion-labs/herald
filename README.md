# Herald

Herald 是一个 Electron 直播助手。工作台包含平台会话、Pi 聊天和嵌入式网页预览。

## 本地开发

首次开发需要 Git、Node.js 24+ 和 Vite+。Setup 会将 `blive-ws` 和 `dylive-ws` 的固定版本克隆到 `vendor/`，按各自的锁文件安装并构建。Herald 通过 pnpm 本地链接使用它们。已有克隆可以重复运行 setup。

```sh
vpx ./scripts/setup-vendor.ts
vp install
vp run dev
```

首次安装后也可以用 `vp run setup` 重新构建这两个依赖。更新上游版本时修改 `scripts/setup-vendor.ts` 中的提交号，再运行 setup。

运行 `vp run ready` 检查格式、类型、测试和桌面构建。运行 `vp run build` 单独构建桌面应用。

## 工作区

- `apps/desktop` 管理 Electron 窗口、网页预览、平台登录分区和 oRPC 接口。React 工作台由 shadcn/ui、TanStack Router 和 Query 驱动。
- `packages/agent` 管理 Pi 会话并组装 Agent 工具。
- `packages/browser-tool`、`packages/history-tool` 和 `packages/skill-tool` 按能力独立提供工具。浏览器工具支持新开、切换、读取、截图、点击、滚动和关闭。点击和滚动使用相对于截图的坐标。预览页的 Agent 光标默认居中，点击时定位到目标位置。
- `packages/live` 把本地 B 站和抖音客户端接入统一的弹幕适配器。
- `packages/memory-tool` 按平台保存观众记忆 Markdown，并通过 QMD 提供关键词查找和 Agent 工具。

桌面应用在 Electron 的 `userData` 下写入会话索引与模型配置。Agent 目录为 `agent/`，对话由 Pi 按平台保存到 `sessions/<平台>/`，格式为 JSONL。设置里的 API Key 使用系统密钥加密，模型运行时也支持 Pi 的 `auth.json`、`models.json` 和环境变量。观众记忆保存在 `memory/<平台>`，可在侧栏打开并查看原始 Markdown。

平台登录和主页浏览器共用持久化的 Electron Session。在设置里为每个平台绑定一个直播间，同平台的会话都使用对应的直播间。主播发送消息时，Herald 把当前房间最近的弹幕作为参考上下文交给 Pi。通用记忆存放在 `memory/shared`，两个平台的会话都可检索。
