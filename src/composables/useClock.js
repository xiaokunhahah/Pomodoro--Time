import { ref, computed, onMounted, onScopeDispose } from 'vue'
import { getClockList, addClock } from '../services/api.js'
import { read } from '../services/storage.js'

/**
 * 本地日期格式化：YYYY-MM-DD（基于本地时区）
 *
 * 为什么不能用 new Date().toISOString().slice(0, 10)？
 * - toISOString() 返回 UTC 时间字符串
 * - 东八区（UTC+8）本地时间比 UTC 快 8 小时
 * - 例：本地 2026-08-21 00:30（凌晨）→ UTC 2026-08-20 16:30
 * - toISOString().slice(0,10) 得到 "2026-08-20"，但本地实际是 8/21
 * - 后果：打卡日期错位 1 天
 *   - 用户 8/21 凌晨学习后打卡，记录写成 8/20
 *   - 8/21 白天再点打卡：hasClockedToday 判断 today(8/21) 是否在记录里
 *     记录里是 8/20，不在 → 允许重复打卡（绕过需求 4）
 * - 正确做法：getFullYear/getMonth/getDate 都用本地时区，构造本地日期串
 */
function formatDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 最近 N 天日期序列（含今日，正序：最老在前，今日在后）
 * 用于日历展示。基于本地时区。
 */
function getLastNDays(n) {
  const arr = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    arr.push(formatDate(d))
  }
  return arr
}

/**
 * 每日学习打卡 composable
 *
 * 职责：
 * - 加载 clockList（走 API：getClockList/addClock）
 * - 从 sessions（仅本地，接口清单无 session 接口）派生今日专注分钟
 * - 派生 hasClockedToday、recent14、streak
 * - clockIn 拦截重复打卡
 *
 * 注意：sessions 不走 API（接口清单未定义），直接 read('sessions')。
 * clockList 走 API，满足"API 失败后页面仍正常更新"。
 */
export function useClock() {
  const clockList = ref([])
  const today = ref(formatDate(new Date()))
  const todayStudyMinutes = ref(0)
  const toast = ref('')
  // 打卡进行中标志：防止连点重入导致同日重复打卡
  // （hasClockedToday 依赖 clockList，第一次 push 在 await 之后，无法靠它去重）
  const submitting = ref(false)

  // toast 定时器句柄：连续触发时先清旧定时器，避免旧 timer 提前关掉新 toast
  let toastTimer = null

  /**
   * 显示 toast 提示并自动消失
   * - 连续调用：先 clearTimeout 上一个定时器，再启新定时器
   *   保证新 toast 的 2s 计时从本次调用开始，不会被旧定时器提前清空
   */
  function showToast(msg) {
    toast.value = msg
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    toastTimer = setTimeout(() => {
      toast.value = ''
      toastTimer = null
    }, 2000)
  }

  /** 加载打卡记录 + 刷新今日分钟 */
  async function load() {
    try {
      const res = await getClockList()
      if (res.data && Array.isArray(res.data)) {
        clockList.value = res.data
      }
    } catch (e) {
      // getClockList 内部已 try/catch 兜底，此为二次防御，不抛给调用方
      console.warn('[useClock] load failed:', e)
    }
    refreshTodayMinutes()
  }

  /**
   * 从 sessions 重新计算今日累计专注分钟
   * - sessions 仅本地存储，每次实时读避免与计时模块不同步
   * - 调用时机：onMounted、clockIn 前、App.vue 完成 study 后
   */
  function refreshTodayMinutes() {
    const s = read('sessions')
    todayStudyMinutes.value = Array.isArray(s)
      ? s
          .filter((x) => x.date === today.value)
          .reduce((sum, x) => sum + (Number(x.minutes) || 0), 0)
      : 0
  }

  /** 今日是否已打卡（按本地日期匹配） */
  const hasClockedToday = computed(() =>
    clockList.value.some((c) => c.date === today.value)
  )

  /**
   * 最近 14 天日期 + 是否已打卡 + 当日学习时长
   * 用前端动态生成日期序列（不能用记录里现成的日期，否则漏掉没打卡的天）
   */
  const recent14 = computed(() => {
    const days = getLastNDays(14)
    return days.map((date) => {
      const rec = clockList.value.find((c) => c.date === date)
      return {
        date,
        isClocked: !!rec,
        studyTime: rec ? rec.studyTime : 0
      }
    })
  })

  /**
   * 连续打卡天数（streak）
   * - 今日已打卡：从今日往回数连续
   * - 今日未打卡：从昨日往回数（需求 10，允许"昨日还在连续中"）
   * - 遇到第一个未打卡的日期停止
   */
  const streak = computed(() => {
    const set = new Set(clockList.value.map((c) => c.date))
    let count = 0
    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)
    // 今日未打卡 → 退一日从昨日开始数
    if (!set.has(formatDate(cursor))) {
      cursor.setDate(cursor.getDate() - 1)
    }
    while (set.has(formatDate(cursor))) {
      count++
      cursor.setDate(cursor.getDate() - 1)
    }
    return count
  })

  /**
   * 打卡
   * - 已打卡 → 拦截 + toast 提示（不弹窗，轻量反馈）
   * - 未打卡 → 实时刷新今日分钟 + 调 API + 更新本地视图
   * - studyTime 允许 0（零分钟打卡，需求测试项）
   */
  async function clockIn() {
    if (hasClockedToday.value) {
      // 连续点打卡：showToast 内部 clearTimeout 旧定时器，提示不会被提前关
      showToast('今日已打卡，无需重复')
      return { ok: false, error: '今日已打卡' }
    }
    // 防重入：第一次 await addClock 期间，hasClockedToday 仍为 false（push 在 await 后）
    // 此时第二次调用会通过上面的去重检查，必须用 submitting 锁拦截
    if (submitting.value) return { ok: false, error: '正在打卡' }
    submitting.value = true
    // 打卡前实时刷新今日分钟（防止 sessions 变化未同步到 todayStudyMinutes）
    refreshTodayMinutes()
    const record = {
      date: today.value,
      studyTime: todayStudyMinutes.value,
      createTime: new Date().toISOString()
    }
    try {
      const res = await addClock(record)
      // 在线：res.data 是服务端权威；离线：res.data === payload（乐观）
      clockList.value.push(res.data || record)
      return { ok: true }
    } catch (e) {
      // addClock 内部已 try/catch 兜底，此为二次防御；不把 e 显示给用户
      console.warn('[useClock] clockIn failed:', e)
      showToast('打卡失败，请稍后重试')
      return { ok: false, error: '打卡失败' }
    } finally {
      submitting.value = false
    }
  }

  onMounted(load)

  // 卸载清理：清掉 toast 定时器，避免组件销毁后定时器仍触发（无副作用但应回收）
  onScopeDispose(() => {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
  })

  return {
    today,
    todayStudyMinutes,
    hasClockedToday,
    recent14,
    streak,
    toast,
    submitting,
    load,
    clockIn,
    refreshTodayMinutes
  }
}
