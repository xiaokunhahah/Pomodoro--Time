# 番茄时钟（Pomodoro Clock）

一个基于 Vue 3 + Vite 的学习专注工具，集成番茄计时、学习任务、每日打卡、数据统计四大模块。采用"API 远端优先 + LocalStorage 兜底"的双层数据策略，断网仍可用，恢复自动同步。

## 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 框架 | Vue 3（Composition API） | `<script setup>` + composables 拆分逻辑 |
| 构建 | Vite 5 | ESM 开发服务器 + 生产打包 |
| HTTP | Axios | 统一实例 + 响应拦截器解包/业务码校验 |
| 图表 | ECharts 5 | 按需注册模块，控制 bundle 体积 |
| 存储 | LocalStorage | 统一 key 前缀 `focusly:`，JSON 损坏静默回退 |
| Mock | Apifox | 静态 Mock 服务，提供接口契约 |

不引入 TypeScript、UI 组件库、状态管理库、外部字体/图片。

## 安装和运行

```bash
# 1. 安装依赖（需 Node.js ≥ 18）
npm install

# 2. 配置环境变量
cp .env.example .env
# 按需修改 .env 中的 API 地址和 Mock 端口

# 3. 启动 Apifox Mock 服务（默认监听 9000）
#    在 Apifox 中打开项目 → 启动 Mock 服务

# 4. 启动开发服务器
npm run dev
# 访问 http://localhost:5174

# 5. 生产构建
npm run build

# 6. 预览生产产物
npm run preview
```

## 目录结构

```
src/
├── App.vue                  # 根组件：编排各模块、初始化 loading/离线提示
├── main.js                   # 应用入口
├── components/               # 展示组件（只接收 props + emit 事件）
│   ├── TaskList.vue          # 任务 CRUD UI + 表单/列表双栏
│   ├── ClockPanel.vue        # 每日打卡 + 14 天日历 + 连续天数
│   └── StatsChart.vue        # ECharts 柱/折线/面积/环形图
├── composables/              # 组合函数（状态 + 逻辑，不碰 DOM）
│   ├── useTimer.js           # 番茄计时核心（绝对 deadline 防漂移）
│   ├── useTask.js            # 任务 CRUD + 防重复提交
│   ├── useClock.js           # 打卡 + 今日分钟聚合 + 连续天数算法
│   └── useStats.js           # 统计聚合（API 优先 + sessions 兜底）
├── services/                 # 服务层
│   ├── api.js                # Axios 实例 + cacheKey/mirror/fallback/queue 四层策略
│   └── storage.js            # LocalStorage 统一读写 + JSON 损坏兜底
├── styles/
│   └── main.css              # 全局变量 + 通用组件样式 + 响应式断点
└── utils/                    # 工具占位（日期工具暂内联于 composables）
```

## Apifox 环境变量

复制 `.env.example` 为 `.env` 后按需修改：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_BASE_URL` | `/api` | 接口基础地址。开发环境在 `vite.config.js` 中通过 proxy 代理到 Apifox Mock |
| `VITE_API_TIMEOUT` | `8000` | 请求超时（毫秒）。超时后自动 fallback 到 LocalStorage |
| `VITE_MOCK_PORT` | `9000` | Apifox Mock 服务端口（供 vite proxy 引用） |

**vite proxy 配置**：开发环境通过 `vite.config.js` 把 `/api` 代理到 `http://localhost:{VITE_MOCK_PORT}`，解决浏览器跨域。生产环境由部署网关处理。

## LocalStorage 数据项

全部以 `focusly:` 为前缀，与同域其他项目隔离。

| Key | 类型 | 字段 | 与 API 的关系 |
|-----|------|------|----------------|
| `focusly:config` | `{studyDuration, restDuration}` | studyDuration/restDuration（分钟） | GET/PUT `/timer/config`，远端成功后镜像 |
| `focusly:tasks` | `Task[]` | id/content/description/status/createTime | GET/POST/PUT/DELETE `/task/*`，写后镜像 |
| `focusly:clocks` | `Clock[]` | date/studyTime/createTime | GET/POST `/clock/*`，写后镜像 |
| `focusly:sessions` | `Session[]` | id/date/minutes/taskId/createTime | **纯本地**，接口清单未定义，由打卡/统计聚合派生 |
| `focusly:pending` | `Op[]` | type/payload/ts | 离线写操作队列，online 事件触发重放 |
| `focusly:chartType` | `'bar'\|'line'\|'area'\|'pie'` | — | UI 偏好，纯本地，不参与 API 同步 |

> JSON 损坏时 `storage.read` 静默回退默认值，不让页面崩溃。

## 构建命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动开发服务器（HMR） |
| `npm run build` | 生产构建，产物输出到 `dist/` |
| `npm run preview` | 本地预览生产产物 |
