import axios from 'axios'
import { read, write, enqueue } from './storage.js'

/* =====================================================================
 * 概念说明（cacheKey / mirror / fallback / queue 四者职责）
 * ---------------------------------------------------------------------
 * cacheKey: 某些 GET 接口成功后，需要把响应 data 同步快照到 LocalStorage
 *           对应 key。仅对主数据（config/tasks/clocks）配置；stat/* 是派生
 *           数据，不缓存（无独立缓存价值，下次需要时再算）。
 *           —— 解决"离线/重启后第一次读有数据"。
 *
 * mirror:   写操作（POST/PUT/DELETE）成功后，把同样的变更应用到 LocalStorage
 *           对应数据，让本地与远端保持一致。离线写时也用 payload 做乐观 mirror
 *           （让用户立即看到效果），重放成功后由下次 GET 自然对齐。
 *           —— 解决"写完不刷新列表就能看到新状态"。
 *
 * fallback: 远端请求失败（网络错误/超时/HTTP 4xx-5xx/业务 code !== 200）时，
 *           从 LocalStorage 读对应数据兜底返回，保证 UI 不崩、功能可用。
 *           GET 返回缓存数据；写操作返回 payload（乐观）+ 入 pending 队列。
 *           —— 解决"断网/Mock 挂掉时页面仍能用"。
 *
 * queue:    离线写操作无法落库时，把操作对象入 pending 队列，浏览器触发
 *           online 事件时按 FIFO 顺序重放，成功则移除、失败保留待下次。
 *           —— 解决"网络恢复后离线期间的写操作不丢失"。
 * ===================================================================== */

// ====================== Axios 实例 ======================
const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: Number(import.meta.env.VITE_API_TIMEOUT) || 8000
})

/**
 * 响应拦截器：统一解包 + 业务码校验
 * - HTTP 2xx 且 body.code === 200 → 透传 body（{code,msg,data}）
 * - HTTP 2xx 但 body.code !== 200 → 构造 isBiz 错误抛出（走失败分支触发 fallback）
 * - HTTP 非 2xx / 超时 / 网络错误 → 原样抛出
 */
http.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && typeof body.code === 'number' && body.code === 200) {
      return body
    }
    const err = new Error(body?.msg || 'BIZ_ERROR')
    err.bizCode = body?.code
    err.isBiz = true
    return Promise.reject(err)
  },
  (err) => Promise.reject(err)
)

// ====================== 配置表 ======================
// GET → LocalStorage 缓存 key（不在表里的 GET 不缓存）
const CACHE_MAP = Object.freeze({
  'GET /timer/config': 'config',
  'GET /task/list': 'tasks',
  'GET /clock/list': 'clocks'
})

/**
 * 写操作 mirror 函数表
 * @param src     在线时=响应 data；离线时=null（用 payload 乐观更新）
 * @param payload 调用方传入的请求体（始终可用，作为离线/兜底数据源）
 * @param list    当前 LocalStorage 中对应列表（仅列表型操作收到）
 * @returns 写入 LocalStorage 的下一份完整数据
 */
const MIRROR = Object.freeze({
  'POST /task/add': (src, payload, list) => [...list, src ?? payload],
  'PUT /task/update': (src, payload, list) =>
    list.map((t) => (t.id === payload.id ? { ...t, ...(src ?? payload) } : t)),
  'DELETE /task/delete': (_src, payload, list) => list.filter((t) => t.id !== payload.id),
  'PUT /timer/config': (src, payload) => src ?? payload,
  'POST /clock/add': (src, payload, list) => [...list, src ?? payload]
})

// 写操作 → 对应 mirror 用的 LocalStorage key
const MIRROR_KEY = Object.freeze({
  'POST /task/add': 'tasks',
  'PUT /task/update': 'tasks',
  'DELETE /task/delete': 'tasks',
  'PUT /timer/config': 'config',
  'POST /clock/add': 'clocks'
})

/**
 * pending 重放映射表
 * 直接调原始 axios（仅走响应拦截器，不再走 fallback），避免重放递归。
 * 重放成功 → 仅从队列移除；本地乐观数据待下次 GET 自然对齐。
 */
const REPLAY = Object.freeze({
  'POST /task/add': (p) => http.post('/task/add', p).then((b) => b.data),
  'PUT /task/update': (p) => http.put('/task/update', p).then((b) => b.data),
  'DELETE /task/delete': (p) => http.delete('/task/delete', { params: p }).then((b) => b.data),
  'PUT /timer/config': (p) => http.put('/timer/config', p).then((b) => b.data),
  'POST /clock/add': (p) => http.post('/clock/add', p).then((b) => b.data)
})

// ====================== 工具函数 ======================
// 在线成功返回
function ok(data) {
  return { data, offline: false }
}
// 离线/失败返回（reason 可选）
function offlineResult(data, reason) {
  return { data, offline: true, reason }
}
// 构造 pending 操作对象
function makeOp(type, payload) {
  return { type, payload, ts: Date.now() }
}
// 错误分类：业务码失败 / 网络失败
function classifyError(e) {
  return e?.isBiz ? 'biz_failed' : 'network'
}

// ====================== GET 通用 ======================
/**
 * GET 请求通用流程
 * - 成功：写快照到 cacheKey 对应 LocalStorage
 * - 失败：fallback 读 cacheKey 对应本地数据
 */
async function httpGet(path, cacheKey) {
  try {
    const body = await http.get(path)
    if (cacheKey) write(cacheKey, body.data)
    return ok(body.data)
  } catch (e) {
    const fallback = cacheKey ? read(cacheKey) : null
    return offlineResult(fallback, classifyError(e))
  }
}

// ====================== 写操作通用 ======================
/**
 * 写操作通用流程
 * @param method        'POST' | 'PUT' | 'DELETE'
 * @param path          接口路径（不含 baseURL）
 * @param opKey         MIRROR/MIRROR_KEY/REPLAY 表中的 key
 * @param payload       请求体（POST/PUT 用 body，DELETE 用 query 对象）
 * @param useQueryParams true 时 payload 走 query（用于 DELETE ?id=xxx）
 *
 * 在线成功 → 用响应 data 做 mirror（保证本地与服务端权威数据一致）
 * 离线失败 → 用 payload 做乐观 mirror + 入 pending 队列
 */
async function httpWrite(method, path, opKey, payload, useQueryParams = false) {
  const mirrorKey = MIRROR_KEY[opKey]
  try {
    const cfg = useQueryParams
      ? { method, url: path, params: payload }
      : { method, url: path, data: payload }
    const body = await http.request(cfg)
    if (mirrorKey) {
      const current = read(mirrorKey)
      const next = MIRROR[opKey](body.data, payload, current)
      write(mirrorKey, next)
    }
    return ok(body.data)
  } catch (e) {
    // 离线兜底：乐观更新本地 + 入 pending 队列
    if (mirrorKey) {
      const current = read(mirrorKey)
      const next = MIRROR[opKey](null, payload, current)
      write(mirrorKey, next)
    }
    enqueue(makeOp(opKey, payload))
    return offlineResult(payload, classifyError(e))
  }
}

// ====================== pending 重放 ======================
let replaying = false
/**
 * 按 FIFO 顺序重放 pending 队列
 * - 成功 → 从队列移除（本地乐观数据待下次 GET 自然对齐）
 * - 失败 → 保留在队列，等下次 online 事件再试
 * - 防重入：replaying 标志避免 online 事件叠加触发
 */
async function replayPending() {
  if (replaying) return
  replaying = true
  try {
    const queue = read('pending')
    if (!Array.isArray(queue) || queue.length === 0) return
    const remain = []
    for (const op of queue) {
      const replayFn = REPLAY[op.type]
      if (!replayFn) {
        // 未知 op.type（结构演进后旧数据）→ 丢弃避免死循环
        console.warn('[api] unknown pending op type, drop:', op.type)
        continue
      }
      try {
        await replayFn(op.payload)
        // 成功：不入 remain，丢弃
      } catch (e) {
        // 失败：保留待下次重放
        remain.push(op)
      }
    }
    write('pending', remain)
  } finally {
    replaying = false
  }
}

// 监听浏览器网络恢复事件，自动触发重放
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', replayPending)
}

// ====================== 对外接口方法 ======================
// 计时器配置
const getTimerConfig = () => httpGet('/timer/config', CACHE_MAP['GET /timer/config'])
const saveTimerConfig = (config) => httpWrite('PUT', '/timer/config', 'PUT /timer/config', config)

// 任务
const getTaskList = () => httpGet('/task/list', CACHE_MAP['GET /task/list'])
const addTask = (task) => httpWrite('POST', '/task/add', 'POST /task/add', task)
const updateTask = (task) => httpWrite('PUT', '/task/update', 'PUT /task/update', task)
const deleteTask = (id) => httpWrite('DELETE', '/task/delete', 'DELETE /task/delete', { id }, true)

// 打卡
const getClockList = () => httpGet('/clock/list', CACHE_MAP['GET /clock/list'])
const addClock = (clock) => httpWrite('POST', '/clock/add', 'POST /clock/add', clock)

// 统计（派生数据，不缓存）
const getStatWeek = () => httpGet('/stat/week', null)
const getStatMonth = () => httpGet('/stat/month', null)

export {
  getTimerConfig,
  saveTimerConfig,
  getTaskList,
  addTask,
  updateTask,
  deleteTask,
  getClockList,
  addClock,
  getStatWeek,
  getStatMonth,
  replayPending
}
