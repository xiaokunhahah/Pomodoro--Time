import { ref, onMounted } from 'vue'
import { getTaskList, addTask, updateTask, deleteTask } from '../services/api.js'

/**
 * 学习任务 composable
 *
 * 职责：维护任务列表视图状态 + currentTaskId；所有持久化通过 dataApi
 * （services/api.js），不直接读写 LocalStorage——满足"API 失败后页面
 * 仍要依靠本地结果正常更新"：api.js 离线时会乐观 mirror 到 LocalStorage
 * 并返回 payload，本 composable 用 res.data 更新视图，UI 即时刷新。
 *
 * 约定：task.status 始终为字符串 '0'（未完成）/ '1'（已完成）。
 */
export function useTask() {
  const tasks = ref([])
  const loading = ref(false)
  // 当前专注任务 ID（仅未完成可设；完成的 session 会写入此 id）
  const currentTaskId = ref(null)
  // 写操作进行中标志：防止连点按钮重复提交（重复请求 + 重复入 pending）
  const submitting = ref(false)

  // 输入长度上限（边界校验，防超长文本撑破 UI / 撑爆 storage）
  const MAX_CONTENT = 50
  const MAX_DESC = 200

  /** 加载全部任务 */
  async function load() {
    loading.value = true
    try {
      const res = await getTaskList()
      if (res.data && Array.isArray(res.data)) {
        tasks.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * 新增任务
   * - 空内容（trim 后）拦截，返回 { ok:false, error }
   * - id/createTime 由前端生成（与 storage schema 一致：时间戳字符串 + ISO）
   * - API 离线时 api.js 乐观 mirror + 入 pending，返回 payload，视图照常更新
   */
  async function add(content, description = '') {
    const trimmed = (content || '').trim()
    if (!trimmed) return { ok: false, error: '任务名称不能为空' }
    if (trimmed.length > MAX_CONTENT) {
      return { ok: false, error: `任务名称不超过 ${MAX_CONTENT} 字` }
    }
    const desc = (description || '').trim()
    if (desc.length > MAX_DESC) {
      return { ok: false, error: `描述不超过 ${MAX_DESC} 字` }
    }
    // 防重复提交：上一次写操作未完成则拦截
    if (submitting.value) return { ok: false, error: '正在处理，请稍候' }
    submitting.value = true
    try {
      const task = {
        id: String(Date.now()),
        content: trimmed,
        description: desc,
        status: '0',
        createTime: new Date().toISOString()
      }
      const res = await addTask(task)
      // 在线：res.data 是服务端权威；离线：res.data === payload（乐观）
      tasks.value.push(res.data || task)
      return { ok: true }
    } catch (e) {
      // addTask 内部已 try/catch 兜底，此为二次防御；不把 e 显示给用户
      console.warn('[useTask] add failed:', e)
      return { ok: false, error: '添加失败，请稍后重试' }
    } finally {
      submitting.value = false
    }
  }

  /**
   * 切换未完成/已完成
   * - status 字符串互换：'0' → '1'，'1' → '0'
   * - 切到已完成时，若它是当前专注任务，清空 currentTaskId（专注应只挂未完成任务）
   */
  async function toggle(id) {
    const t = tasks.value.find((x) => x.id === id)
    if (!t) return
    const next = { ...t, status: t.status === '0' ? '1' : '0' }
    try {
      const res = await updateTask(next)
      const idx = tasks.value.findIndex((x) => x.id === id)
      if (idx >= 0) tasks.value[idx] = res.data || next
      if (next.status === '1' && currentTaskId.value === id) {
        currentTaskId.value = null
      }
    } catch (e) {
      console.warn('[useTask] toggle failed:', e)
    }
  }

  /**
   * 编辑任务名称和描述
   * - 名称 trim 后为空拦截（编辑后不能为空）
   */
  async function edit(id, content, description) {
    const t = tasks.value.find((x) => x.id === id)
    if (!t) return { ok: false, error: '任务不存在' }
    const trimmed = (content || '').trim()
    if (!trimmed) return { ok: false, error: '任务名称不能为空' }
    if (trimmed.length > MAX_CONTENT) {
      return { ok: false, error: `任务名称不超过 ${MAX_CONTENT} 字` }
    }
    const desc = (description || '').trim()
    if (desc.length > MAX_DESC) {
      return { ok: false, error: `描述不超过 ${MAX_DESC} 字` }
    }
    if (submitting.value) return { ok: false, error: '正在处理，请稍候' }
    submitting.value = true
    try {
      const next = { ...t, content: trimmed, description: desc }
      const res = await updateTask(next)
      const idx = tasks.value.findIndex((x) => x.id === id)
      if (idx >= 0) tasks.value[idx] = res.data || next
      return { ok: true }
    } catch (e) {
      console.warn('[useTask] edit failed:', e)
      return { ok: false, error: '保存失败，请稍后重试' }
    } finally {
      submitting.value = false
    }
  }

  /** 删除单个任务 */
  async function remove(id) {
    try {
      await deleteTask(id)
      tasks.value = tasks.value.filter((t) => t.id !== id)
      if (currentTaskId.value === id) currentTaskId.value = null
    } catch (e) {
      console.warn('[useTask] remove failed:', e)
    }
  }

  /**
   * 清空全部任务
   * - 接口清单无批量删除接口，串行调用 deleteTask(id)
   * - 串行而非并发：避免并发 mirror 读改写丢更新
   * - 离线时每条都会 enqueue pending，重放时按序删除
   */
  async function clearAll() {
    try {
      const ids = tasks.value.map((t) => t.id)
      for (const id of ids) {
        await deleteTask(id)
      }
      tasks.value = []
      currentTaskId.value = null
    } catch (e) {
      console.warn('[useTask] clearAll failed:', e)
    }
  }

  /**
   * 设为当前专注任务
   * - 仅未完成（status === '0'）可设；已完成直接 return
   */
  function setCurrent(id) {
    const t = tasks.value.find((x) => x.id === id)
    if (!t) return
    if (t.status !== '0') return
    currentTaskId.value = id
  }

  function clearCurrent() {
    currentTaskId.value = null
  }

  onMounted(load)

  return {
    tasks,
    loading,
    submitting,
    currentTaskId,
    load,
    add,
    toggle,
    edit,
    remove,
    clearAll,
    setCurrent,
    clearCurrent
  }
}
