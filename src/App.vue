<template>
  <div class="app">
    <!-- 初始化加载遮罩：拉取配置期间覆盖，避免用户看到假就绪的 25:00 -->
    <div v-if="appLoading" class="app-loading">
      <div class="app-loading__spinner"></div>
      <span class="app-loading__text">加载中…</span>
    </div>

    <header class="app__header">
      <h1 class="app__title">番茄时钟</h1>
      <p class="app__subtitle">专注 · 打卡 · 统计</p>
    </header>

    <!-- 离线横幅：断网时可见提示，恢复后自动消失 -->
    <div v-if="offline" class="offline-banner">
      网络已断开，更改将保存在本地，恢复后自动同步
    </div>

    <!-- 计时器 + 今日进度 双栏（桌面） -->
    <div class="grid grid--focus">
      <section class="timer-zone">
        <!-- 模式切换 -->
        <div class="mode-switch">
          <button
            class="mode-btn"
            :class="{ 'mode-btn--active': mode === 'study' }"
            :disabled="running"
            @click="onSwitchMode('study')"
          >专注</button>
          <button
            class="mode-btn"
            :class="{ 'mode-btn--active': mode === 'rest' }"
            :disabled="running"
            @click="onSwitchMode('rest')"
          >休息</button>
        </div>

        <!-- 圆形进度表盘 -->
        <div class="dial" :style="dialStyle">
          <div class="dial__inner">
            <div class="dial__time">{{ display }}</div>
            <div class="dial__mode">{{ mode === 'study' ? '专注中' : '休息中' }}</div>
          </div>
        </div>

        <!-- 控制按钮 -->
        <div class="controls">
          <button class="btn btn--primary" @click="onToggleRun">
            {{ running ? '暂停' : '开始' }}
          </button>
          <button class="btn" :disabled="running" @click="onReset">重置</button>
          <button class="btn" @click="openSettings">设置</button>
        </div>
      </section>

      <!-- 每日打卡 / 今日进度（右栏） -->
      <ClockPanel
      :today="clockToday"
      :today-study-minutes="todayStudyMinutes"
      :has-clocked-today="hasClockedToday"
      :recent14="recent14"
      :streak="streak"
      :toast="clockToast"
      :submitting="clockSubmitting"
      @clock-in="clockIn"
    />
    </div>

    <!-- 指标卡片 -->
    <div class="metrics">
      <div class="metric-card">
        <div class="metric-card__label">今日专注</div>
        <div class="metric-card__value">
          {{ todayStudyMinutes }}<span class="metric-card__unit">分</span>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-card__label">连续打卡</div>
        <div class="metric-card__value">
          {{ streak }}<span class="metric-card__unit">天</span>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-card__label">任务总数</div>
        <div class="metric-card__value">
          {{ tasks.length }}<span class="metric-card__unit">个</span>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-card__label">已完成</div>
        <div class="metric-card__value">
          {{ doneCount }}<span class="metric-card__unit">个</span>
        </div>
      </div>
    </div>

    <!-- 任务清单模块（内部表单/列表双栏） -->
    <TaskList
      :tasks="tasks"
      :current-task-id="currentTaskId"
      :loading="taskLoading"
      :submitting="taskSubmitting"
      @add="({ content, description }) => addTaskItem(content, description)"
      @toggle="toggleTask"
      @edit="({ id, content, description }) => editTask(id, content, description)"
      @delete="removeTask"
      @clear-all="clearAllTasks"
      @set-current="setCurrentTask"
      @clear-current="clearCurrentTask"
    />

    <!-- 数据统计模块 -->
    <StatsChart
      :data="statData"
      :range="statsRange"
      :is-empty="statsIsEmpty"
      :type="chartType"
      @range-change="setStatsRange"
      @type-change="setChartType"
    />

    <!-- 设置弹窗 -->
    <div v-if="showSettings" class="modal-mask" @click.self="closeSettings">
      <div class="modal">
        <h2 class="modal__title">设置时长</h2>
        <div class="field">
          <label>专注时长（1 ~ 180 分钟）</label>
          <input
            v-model="configDraft.study"
            class="input"
            type="number"
            min="1"
            max="180"
            placeholder="如 25"
          />
        </div>
        <div class="field">
          <label>休息时长（1 ~ 60 分钟）</label>
          <input
            v-model="configDraft.rest"
            class="input"
            type="number"
            min="1"
            max="60"
            placeholder="如 5"
          />
        </div>
        <p v-if="configError" class="field__error">{{ configError }}</p>
        <div class="modal__actions">
          <button class="btn" @click="closeSettings">取消</button>
          <button class="btn btn--primary" :disabled="saving" @click="saveConfig">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 完成弹窗（不使用浏览器 alert） -->
    <div v-if="showFinish" class="modal-mask" @click.self="dismissFinish">
      <div class="modal">
        <h2 class="modal__title">
          {{ finishMode === 'study' ? '专注完成' : '休息结束' }}
        </h2>
        <p class="modal__hint">
          {{ finishMode === 'study'
            ? '已记录一次专注，休息一下吧'
            : '可以开始下一轮专注了' }}
        </p>
        <div class="modal__actions">
          <button class="btn btn--primary" @click="dismissFinish">知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useTimer } from './composables/useTimer.js'
import { useTask } from './composables/useTask.js'
import { useClock } from './composables/useClock.js'
import { useStats } from './composables/useStats.js'
import TaskList from './components/TaskList.vue'
import ClockPanel from './components/ClockPanel.vue'
import StatsChart from './components/StatsChart.vue'
import { getTimerConfig, saveTimerConfig } from './services/api.js'
import { read, write } from './services/storage.js'

/* ---- 内联日期工具（后续 utils/date.js 阶段统一迁移） ---- */
function getToday() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/* =========================================================
 * 三类状态关系
 * ---------------------------------------------------------
 * config:       当前已生效的配置（分钟），来源：API 加载或本地保存。
 *               是 timer 实际使用的真值。
 * configDraft:  设置弹窗中的临时编辑草稿（字符串，因 input v-model）。
 *               未点保存前不影响 timer，可随时取消丢弃。
 * timer:        useTimer 实例，内部 studyDuration/restDuration 是 ms。
 *               通过 applyConfig(config) 接收分钟 → ms 转换并应用。
 *
 * 流向：
 *   加载：  API → config → timer.applyConfig → timer.reset
 *   编辑：  用户输入 → configDraft（不立刻生效）
 *   保存：  configDraft → 校验 → saveTimerConfig(API) → config → timer.applyConfig → reset
 * ========================================================= */
const config = ref({ studyDuration: 25, restDuration: 5 })
const configDraft = ref({ study: '25', rest: '5' })
const configError = ref('')

const showSettings = ref(false)
const showFinish = ref(false)
const finishMode = ref('study')

/* ---- 加载/保存状态 ----
 * appLoading：初始化拉取配置期间显示遮罩，避免用户看到假就绪的默认 25:00
 * saving：保存配置期间防重复提交（连点保存发多次请求 + 重复入 pending）
 * offline：网络断开时显示可见横幅（navigator.onLine + online/offline 事件）
 */
const appLoading = ref(true)
const saving = ref(false)
const offline = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false)
function updateOnline() {
  offline.value = !navigator.onLine
}

/* ---- 任务模块 ----
 * taskStore 先于 timer 创建：onComplete 闭包需引用 taskStore.currentTaskId
 */
const taskStore = useTask()
const {
  tasks,
  currentTaskId,
  loading: taskLoading,
  submitting: taskSubmitting,
  add: addTaskItem,
  toggle: toggleTask,
  edit: editTask,
  remove: removeTask,
  clearAll: clearAllTasks,
  setCurrent: setCurrentTask,
  clearCurrent: clearCurrentTask
} = taskStore

/* ---- 打卡模块 ----
 * clockStore 先于 timer 创建：onComplete 闭包需调 clockStore.refreshTodayMinutes
 */
const clockStore = useClock()
const {
  today: clockToday,
  todayStudyMinutes,
  hasClockedToday,
  recent14,
  streak,
  toast: clockToast,
  submitting: clockSubmitting,
  clockIn: doClockIn,
  refreshTodayMinutes
} = clockStore

/* ---- 统计模块 ----
 * statsStore 先于 timer 创建：onComplete 闭包需调 statsStore.load
 */
const statsStore = useStats()
const {
  range: statsRange,
  statData,
  isEmpty: statsIsEmpty,
  setRange: setStatsRange
} = statsStore

/* ---- 指标卡片派生数据（仅展示，不改动数据流）----
 * doneCount：已完成任务数，由 tasks 派生，不写回 store
 */
const doneCount = computed(
  () => tasks.value.filter((t) => t.status === '1').length
)

/* ---- 图表类型偏好（UI 偏好，仅本地，不参与 api 同步）----
 * 从 LocalStorage 读上次选择；非法值（被篡改/旧版本无此 key）回退 'bar'
 * 7 天/30 天切换不影响 type，故 range 与 type 解耦存储
 */
const VALID_TYPES = ['bar', 'line', 'area', 'pie']
const savedType = read('chartType')
const chartType = ref(VALID_TYPES.includes(savedType) ? savedType : 'bar')
function setChartType(t) {
  if (!VALID_TYPES.includes(t)) return
  if (t === chartType.value) return
  chartType.value = t
  write('chartType', t)
}

/* ---- 计时核心 ----
 * onComplete 在 useTimer 内部 finish() 时调用：
 * - 仅 finishedMode === 'study' 时生成 session 记录（需求 10）
 * - session.taskId 写入当前专注任务 ID（若已设置）
 * - 完成后刷新打卡模块的今日专注分钟（让用户点打卡时拿到最新累计）
 * - 完成后刷新统计模块（新 session 已入本地，聚合后图表实时更新）
 * - 总是显示完成弹窗（专注完成 / 休息结束）
 */
const timer = useTimer((finishedMode) => {
  if (finishedMode === 'study') {
    const session = {
      id: String(Date.now()),
      date: getToday(),
      minutes: config.value.studyDuration, // 分钟
      taskId: currentTaskId.value, // 当前专注任务 ID（无则 null）
      createTime: new Date().toISOString()
    }
    // session 直读/直写 LocalStorage：接口清单未定义 session 接口，
    // 它是纯本地原始记录，由 useClock/useStats 聚合派生（详见各 composable）
    const list = read('sessions')
    if (Array.isArray(list)) {
      list.push(session)
      write('sessions', list)
    }
    // 通知打卡模块：今日专注分钟已变化
    refreshTodayMinutes()
    // 通知统计模块：本地 sessions 已更新，重新聚合后图表重绘
    statsStore.load()
  }
  finishMode.value = finishedMode
  showFinish.value = true
})

const { mode, running, progress, display, start, pause, reset, applyConfig, setMode } = timer

/* ---- 表盘样式（CSS 变量驱动 conic-gradient） ----
 * --progress: 0~100，进度环弧度
 * --ring:      当前模式主色（study 红 / rest 蓝），统一饱和度风格
 * --track:     轨道色
 */
const dialStyle = computed(() => ({
  '--progress': (progress.value * 100).toFixed(2),
  '--ring': mode.value === 'study' ? '#ff6b6b' : '#4dabf7',
  '--track': '#e4e7eb'
}))

/* ---- 模式切换 ----
 * 运行中禁止切换，避免计时错乱
 */
function onSwitchMode(m) {
  if (running.value) return
  setMode(m)
}

/* ---- 控制按钮 ----
 * 点开始/暂停：若完成弹窗开着，先关掉再继续
 */
function onToggleRun() {
  if (showFinish.value) showFinish.value = false
  if (running.value) pause()
  else start()
}

function onReset() {
  if (running.value) return // 运行中禁止重置
  reset()
}

/* ---- 设置弹窗 ----
 * 打开时把当前 config 同步到 draft（让用户在已生效值基础上编辑）
 */
function openSettings() {
  configDraft.value.study = String(config.value.studyDuration)
  configDraft.value.rest = String(config.value.restDuration)
  configError.value = ''
  showSettings.value = true
}

function closeSettings() {
  showSettings.value = false
  configError.value = ''
}

/**
 * 输入校验：非数字 / 空值 / 负数 / 超范围 / 非整数
 * - Number('') === 0（空值会落入下界判断）
 * - Number('abc') === NaN（Number.isFinite 拦截）
 */
function validateDraft() {
  const s = Number(configDraft.value.study)
  const r = Number(configDraft.value.rest)
  if (!Number.isFinite(s) || s < 1 || s > 180) {
    return '专注时长需为 1~180 的整数'
  }
  if (!Number.isFinite(r) || r < 1 || r > 60) {
    return '休息时长需为 1~60 的整数'
  }
  if (!Number.isInteger(s) || !Number.isInteger(r)) {
    return '时长需为整数分钟'
  }
  return null
}

async function saveConfig() {
  // 防重复提交：上一次保存未完成则拦截
  if (saving.value) return
  const err = validateDraft()
  if (err) {
    configError.value = err
    return
  }
  saving.value = true
  try {
    const next = {
      studyDuration: Number(configDraft.value.study),
      restDuration: Number(configDraft.value.rest)
    }
    // 调 API：api.js 内部会 mirror 到 LocalStorage + 离线时入 pending 队列
    await saveTimerConfig(next)
    // 提升 draft → config，并应用到 timer + 重置计时
    config.value = next
    applyConfig(next)
    reset()
    showSettings.value = false
  } catch (e) {
    // saveTimerConfig 内部已 try/catch 兜底，此为二次防御；不把 e 显示给用户
    console.warn('[App] saveConfig failed:', e)
    configError.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

/* ---- 完成弹窗 ---- */
function dismissFinish() {
  showFinish.value = false
}

/* ---- 初始化：加载配置 ----
 * 优先 API；失败时 api.js 内部已 fallback 到 LocalStorage，data 仍是有效配置
 * - appLoading 期间显示遮罩，避免用户看到假就绪的默认 25:00
 * - try/catch 二次防御：即使 api 层有未预期异常，页面也不崩
 * - 注册 online/offline 监听，断网/恢复时更新可见横幅
 */
onMounted(() => {
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
  ;(async () => {
    try {
      const res = await getTimerConfig()
      if (res.data && typeof res.data.studyDuration === 'number') {
        config.value = { ...res.data }
        configDraft.value.study = String(res.data.studyDuration)
        configDraft.value.rest = String(res.data.restDuration)
        applyConfig(res.data)
        reset()
      }
    } catch (e) {
      console.warn('[App] init config failed:', e)
    } finally {
      appLoading.value = false
    }
  })()
})

/* ---- 卸载清理：移除 online/offline 监听，避免内存泄漏 ----
 * App 根组件卸载 = 应用退出，正常不会触发，但满足"事件监听器正确清理"
 */
onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
</script>

<style scoped>
/* ============================================================
 * 布局骨架
 * - .app 纵向 flex + gap 统一模块间距，子组件不再各自 margin-top
 * - max-width 用 --container-max，桌面利用双栏空间
 * - 防横向滚动：minmax(0,1fr) 保证 grid 子项可收缩
 * ============================================================ */
.app {
  max-width: var(--container-max);
  margin: 0 auto;
  padding: var(--space-xl) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
  position: relative; /* appLoading 遮罩定位锚点 */
}

/* 初始化加载遮罩：覆盖整个 .app，避免用户在配置加载前操作 */
.app-loading {
  position: fixed;
  inset: 0;
  background: var(--color-bg);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
}
/* 旋转加载圈（CSS 实现，无图片依赖） */
.app-loading__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: app-spin 0.8s linear infinite;
}
.app-loading__text {
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}
@keyframes app-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 尊重 reduced-motion：关闭旋转动画 */
@media (prefers-reduced-motion: reduce) {
  .app-loading__spinner {
    animation: none;
  }
}

/* 离线横幅 */
.offline-banner {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffe69c;
  border-radius: var(--radius-md);
  padding: 10px var(--space-md);
  font-size: var(--font-sm);
  text-align: center;
}

.app__header {
  text-align: center;
}
.app__title {
  font-size: var(--font-2xl);
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
  letter-spacing: 0.5px;
}
.app__subtitle {
  margin: 4px 0 0;
  font-size: var(--font-sm);
  color: var(--color-text-muted);
}

/* 双栏：计时器 + 今日进度（桌面 ≥851px） */
.grid {
  display: grid;
  gap: var(--space-lg);
  align-items: start;
}
.grid--focus {
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 851px) {
  .grid--focus {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

/* 计时器卡片 */
.timer-zone {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--shadow-xs);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
}

/* 模式切换 */
.mode-switch {
  display: inline-flex;
  gap: 4px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 4px;
}
.mode-btn {
  border: none;
  background: transparent;
  padding: 8px 22px;
  border-radius: var(--radius-pill);
  font-size: var(--font-md);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.mode-btn:hover:not(.mode-btn--active):not(:disabled) {
  color: var(--color-text);
}
.mode-btn--active {
  background: var(--color-primary);
  color: #fff;
}
.mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 圆形表盘
 * conic-gradient 双 stop 同位形成硬边界
 *   - ring 从 0% 到 progress%（顺时针，起点 12 点）
 *   - track 从 progress% 延伸到 100%
 * 手机端 min(72vw, 300px) 保证不溢出
 */
.dial {
  width: min(72vw, 300px);
  height: min(72vw, 300px);
  border-radius: 50%;
  background: conic-gradient(
    var(--ring) calc(var(--progress) * 1%),
    var(--track) calc(var(--progress) * 1%)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.25s ease;
}
.dial__inner {
  width: 86%;
  height: 86%;
  border-radius: 50%;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
}
.dial__time {
  font-size: 54px;
  font-weight: 700;
  font-variant-numeric: tabular-nums; /* 等宽数字，跳秒不抖动 */
  color: var(--color-text);
  letter-spacing: 1px;
}
.dial__mode {
  margin-top: 4px;
  font-size: var(--font-sm);
  color: var(--color-text-muted);
}

/* 控制按钮容器 */
.controls {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap; /* 手机端窄屏自动换行，不溢出 */
}

/* 指标卡片 */
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-md);
}
.metric-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  box-shadow: var(--shadow-xs);
  text-align: center;
  min-width: 0;
}
.metric-card__label {
  font-size: var(--font-sm);
  color: var(--color-text-muted);
}
.metric-card__value {
  font-size: var(--font-2xl);
  font-weight: 700;
  color: var(--color-text);
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.metric-card__unit {
  font-size: var(--font-sm);
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: 2px;
}

/* ---- 断点 ---- */
/* 平板 ≤850px：双栏变单列，指标卡片 2 列 */
@media (max-width: 850px) {
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* 手机 ≤640px：全部单列，间距/字号压缩 */
@media (max-width: 640px) {
  .app {
    padding: var(--space-md);
    gap: var(--space-lg);
  }
  .dial {
    width: min(70vw, 280px);
    height: min(70vw, 280px);
  }
  .dial__time {
    font-size: 44px;
  }
  .timer-zone {
    padding: var(--space-md);
  }
}
</style>
