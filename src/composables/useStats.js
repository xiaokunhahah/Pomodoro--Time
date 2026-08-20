import { ref, computed } from 'vue'
import { getStatWeek, getStatMonth } from '../services/api.js'
import { read } from '../services/storage.js'

/**
 * 本地日期格式化：YYYY-MM-DD（本地时区）
 * 与 useClock.formatDate 同实现，避免 toISOString 跨时区错位
 */
function formatDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 最近 N 天日期序列（从旧到新，今日为最后一项）
 * - 前端动态生成：保证没打卡的天也在序列里（补 0）
 * - 不能用记录里现成的日期，否则漏掉空白天
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
 * 从本地 sessions 聚合统计
 * - 按日期 sum sessions.minutes
 * - 没记录的天补 0
 * - 输出字段 studyTime（与 API 返回结构对齐）
 */
function aggregateFromSessions(days) {
  const s = read('sessions')
  const list = Array.isArray(s) ? s : []
  return days.map((date) => ({
    date,
    studyTime: list
      .filter((x) => x.date === date)
      .reduce((sum, x) => sum + (Number(x.minutes) || 0), 0)
  }))
}

/**
 * 数据统计 composable
 *
 * 职责：
 * - 维护 range（'week' | 'month'）
 * - 优先请求 /stat/week | /stat/month
 * - 失败/空 → 从本地 sessions 聚合（补 0 + 从旧到新排序）
 * - 暴露 statData、isEmpty
 *
 * 注意：stat 不缓存（派生数据，无独立缓存价值，下次需要时再算）
 */
export function useStats() {
  const range = ref('week')
  const statData = ref([])
  const loading = ref(false)

  // 空状态：所有 studyTime 为 0 或数组为空
  const isEmpty = computed(
    () =>
      statData.value.length === 0 ||
      statData.value.every((x) => !Number(x.studyTime))
  )

  async function load() {
    loading.value = true
    try {
      const res =
        range.value === 'week' ? await getStatWeek() : await getStatMonth()
      // API 成功且有数据 → 直接用
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        statData.value = res.data
        return
      }
      // API 失败/空 → 本地聚合（补 0）
      const days = getLastNDays(range.value === 'week' ? 7 : 30)
      statData.value = aggregateFromSessions(days)
    } catch (e) {
      // 异常兜底：本地聚合
      const days = getLastNDays(range.value === 'week' ? 7 : 30)
      statData.value = aggregateFromSessions(days)
    } finally {
      loading.value = false
    }
  }

  function setRange(r) {
    if (r !== 'week' && r !== 'month') return
    if (r === range.value) return
    range.value = r
    load()
  }

  // 初始加载
  load()

  return {
    range,
    statData,
    loading,
    isEmpty,
    load,
    setRange
  }
}
