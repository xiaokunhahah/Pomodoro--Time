import { ref, computed, readonly, getCurrentScope, onScopeDispose } from 'vue'

/**
 * 计时模式
 * - study：专注学习
 * - rest：休息
 */
const MODE = Object.freeze({ STUDY: 'study', REST: 'rest' })

/**
 * ticker 刷新频率：250ms
 *
 * 为什么 250ms 而不是 1000ms？
 * - 真正的"剩余时间"由 deadline - Date.now() 反推，与 setInterval 频率无关；
 *   setInterval 只负责"刷新显示用 now 锚点"，不参与计时逻辑。
 * - 1000ms 也能跳秒，但 setInterval 回调会因 JS 单线程繁忙而延后几十~几百 ms，
 *   导致跳秒时机偏离真实秒边界（用户视觉上"卡一下")。
 * - 250ms 让跳秒时机与真实秒边界的误差 ≤ 250ms，视觉上"准"；同时 4Hz 频率
 *   对 CPU 几乎无负担。
 * - 即使后台节流（≥1 分钟才回调一次），恢复前台后 deadline - now 仍准确，
 *   不会因回调稀疏而漏计。
 */
const TICK_MS = 250

/**
 * 番茄计时 composable
 *
 * 核心原理：
 * 1. 时间依据是绝对 deadline 时间戳（Date.now() + 设定时长），而不是"每秒减 1"；
 * 2. remaining = deadline - now，由响应式 now 触发重算；
 * 3. setInterval 仅负责更新 now（每 250ms），让 UI 跳秒；
 * 4. visibilitychange 监听：后台恢复前台时立即刷新 now，无需等下一个 tick；
 * 5. 计时自然结束 → 切换模式（study↔rest）→ 不自动开始 → 调 onComplete。
 *
 * @param {(finishedMode: 'study'|'rest') => void} [onComplete] 计时结束时回调
 */
export function useTimer(onComplete) {
  // ---------------- 响应式状态 ----------------
  const mode = ref(MODE.STUDY)             // 当前模式
  const running = ref(false)              // 是否运行
  const studyDuration = ref(25 * 60 * 1000) // 学习时长（ms）
  const restDuration = ref(5 * 60 * 1000)  // 休息时长（ms）
  const deadline = ref(0)                   // 绝对截止时间戳（仅运行时有效）
  const pausedRemaining = ref(0)           // 暂停时冻结的剩余 ms
  const now = ref(Date.now())              // 当前时间锚点（每 tick 更新，触发重算）

  let tickerId = null                      // setInterval 句柄

  // ---------------- 派生计算 ----------------
  // 当前模式时长（ms）
  function durationOf(m) {
    return m === MODE.REST ? restDuration.value : studyDuration.value
  }

  /**
   * 剩余 ms（核心）
   * - 运行态：deadline - now 反推，永远准确
   * - 暂停/停止态：用冻结的 pausedRemaining
   */
  const remaining = computed(() => {
    if (running.value) {
      return Math.max(0, deadline.value - now.value)
    }
    return pausedRemaining.value
  })

  // 进度 0~1（已用 / 总）
  const progress = computed(() => {
    const total = durationOf(mode.value)
    if (total <= 0) return 0
    return Math.min(1, Math.max(0, (total - remaining.value) / total))
  })

  /**
   * 显示字符串：MM:SS 或 HH:MM:SS
   * - 按 Math.floor(remaining/1000) 取整秒
   * - 即使 now 每 250ms 变化，秒级显示只在跨秒边界才跳
   */
  const display = computed(() => {
    const totalSec = Math.floor(remaining.value / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = (n) => String(n).padStart(2, '0')
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  })

  // ---------------- ticker 生命周期 ----------------
  /**
   * 启动 ticker（防叠加）
   * - 若 tickerId !== null 表示已有定时器在跑，直接 return，避免 setInterval 叠加
   * - 只更新 now.value，不做任何"减 1"逻辑
   */
  function startTicker() {
    if (tickerId !== null) return
    tickerId = setInterval(() => {
      now.value = Date.now()
      // 运行态且剩余 ≤ 0 → 自然结束
      if (running.value && deadline.value - now.value <= 0) {
        finish()
      }
    }, TICK_MS)
  }

  /**
   * 停止 ticker
   * - 清掉 setInterval 并置 null，确保下次 startTicker 能重新启动
   * - 组件卸载 / 暂停 / 重置 / 完成时都会调用
   */
  function stopTicker() {
    if (tickerId !== null) {
      clearInterval(tickerId)
      tickerId = null
    }
  }

  /**
   * 计时自然结束处理
   * - 先 stopTicker：避免 finish 在 setInterval 内重复触发
   * - 切换模式：study → rest，rest → study（不自动开始）
   * - 调用 onComplete(finishedMode)
   */
  function finish() {
    stopTicker()
    const finishedMode = mode.value
    const nextMode = finishedMode === MODE.STUDY ? MODE.REST : MODE.STUDY
    running.value = false
    deadline.value = 0
    mode.value = nextMode
    pausedRemaining.value = durationOf(nextMode)
    if (typeof onComplete === 'function') {
      try {
        onComplete(finishedMode)
      } catch (e) {
        console.warn('[useTimer] onComplete callback error:', e)
      }
    }
  }

  // ---------------- 对外控制方法 ----------------
  /**
   * 开始 / 继续
   * - 防叠加：running 已为 true 则 return
   * - 暂停续跑：用 pausedRemaining 推算 deadline
   * - 首次启动：用当前模式总时长推算 deadline
   * - 时长 ≤ 0 时不启动（防止 0 时长即结束）
   */
  function start() {
    if (running.value) return
    const left = pausedRemaining.value > 0 ? pausedRemaining.value : durationOf(mode.value)
    if (left <= 0) return
    deadline.value = Date.now() + left
    running.value = true
    startTicker()
  }

  /**
   * 暂停
   * - 非运行态 return（避免误清 pausedRemaining）
   * - 把当前 remaining 冻结到 pausedRemaining
   * - 停 ticker
   */
  function pause() {
    if (!running.value) return
    pausedRemaining.value = remaining.value
    running.value = false
    deadline.value = 0
    stopTicker()
  }

  /**
   * 重置
   * - 停 ticker + 清运行态
   * - pausedRemaining 恢复为当前模式初始时长
   */
  function reset() {
    stopTicker()
    running.value = false
    deadline.value = 0
    pausedRemaining.value = durationOf(mode.value)
  }

  /**
   * 手动切换模式（会重置计时）
   * - 与当前模式相同则不处理
   * - 停 ticker + 切 mode + pausedRemaining 重置为新模式时长
   */
  function setMode(m) {
    if (m !== MODE.STUDY && m !== MODE.REST) return
    if (m === mode.value) return
    stopTicker()
    running.value = false
    deadline.value = 0
    mode.value = m
    pausedRemaining.value = durationOf(m)
  }

  /**
   * 应用新配置（分钟 → ms）
   * - 仅对合法正数生效（非数字/负数/0 被忽略，由调用方做容错提示）
   * - 运行态不打断当前计时（避免运行中改时长导致 deadline 漂移）
   * - 非运行态：pausedRemaining 重置为新时长
   */
  function applyConfig({ studyDuration: studyMin, restDuration: restMin } = {}) {
    if (Number.isFinite(studyMin) && studyMin > 0) {
      studyDuration.value = studyMin * 60 * 1000
    }
    if (Number.isFinite(restMin) && restMin > 0) {
      restDuration.value = restMin * 60 * 1000
    }
    if (!running.value) {
      pausedRemaining.value = durationOf(mode.value)
    }
  }

  // ---------------- 后台恢复修正 ----------------
  /**
   * 监听 visibilitychange：后台恢复前台时主动刷新 now
   * - 浏览器对后台标签 setInterval 节流（≥1 分钟才回调）
   * - 恢复前台时若等下一个 250ms tick 才更新 now，UI 会"卡顿一拍"
   * - 主动 now.value = Date.now() + 检查是否已超 deadline → 立即修正
   */
  function onVisible() {
    if (typeof document === 'undefined') return
    if (document.visibilityState !== 'visible') return
    now.value = Date.now()
    if (running.value && deadline.value - now.value <= 0) {
      finish()
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }

  // ---------------- 卸载清理 ----------------
  // 仅在 effectScope 内注册（如组件 setup 中调用）；scope 外调用需手动 stop()
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stopTicker()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
      }
    })
  }

  return {
    // 只读状态
    mode: readonly(mode),
    running: readonly(running),
    remaining,
    progress,
    display,
    // 可写配置（供组件 v-model 绑定）
    studyDuration,
    restDuration,
    // 控制
    start,
    pause,
    reset,
    setMode,
    applyConfig,
    stop: stopTicker
  }
}
