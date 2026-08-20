/**
 * LocalStorage 数据服务
 * ------------------------------------------------------------------
 * 设计目标：
 * 1. 单一入口管理全部本地持久化数据，避免散落各处 key 命名冲突；
 * 2. 任何读写异常都不能让页面崩溃（隐私模式禁用 Storage、quota 超限、
 *    用户手动篡改 JSON 都属高频边界）；
 * 3. 默认值不能被调用方污染——默认对象 freeze + 每次返回深拷贝双重保险；
 * 4. 离线待同步队列有上限，防止无限增长吃满 LocalStorage 配额。
 *
 * 与 services/api.js 的协作：
 * - 本模块只负责"读写本地"，不感知 api；
 * - 调用方（composables）负责"先 api 后 storage"的兜底编排；
 * - 写 api 成功后回写 storage，失败时改写 storage + 入队 pending，
 *   待联网后由调用方 flush pending 队列回 Mock。
 */

// 统一 key 前缀：项目隔离，避免与其他项目同域 localStorage 互相覆盖
const PREFIX = 'focusly:'

// 离线待同步队列上限：FIFO 溢出丢最老一条，防止 quota 被队列吃满
const MAX_PENDING = 100

// 全部 key 常量：freeze 防止运行时被意外修改导致 key 漂移
const KEYS = Object.freeze({
  config: PREFIX + 'config',
  tasks: PREFIX + 'tasks',
  clocks: PREFIX + 'clocks',
  sessions: PREFIX + 'sessions',
  pending: PREFIX + 'pending',
  // UI 偏好（非业务数据源），仅本地，不参与 api 同步
  chartType: PREFIX + 'chartType'
})

/**
 * 默认值表
 * - 顶层 freeze：阻止 DEFAULTS.key 被替换
 * - 内层 freeze：阻止 DEFAULTS.config.xxx 被改写
 * - read 返回前再做 clone，调用方拿到的永远是独立副本
 */
const DEFAULTS = Object.freeze({
  config: Object.freeze({ studyDuration: 25, restDuration: 5 }),
  tasks: Object.freeze([]),
  clocks: Object.freeze([]),
  sessions: Object.freeze([]),
  pending: Object.freeze([]),
  chartType: 'bar'
})

/**
 * 深拷贝：JSON 序列化往返
 * 本项目数据均为纯 JSON 类型（无 Date/Map/函数），该方案足够且零依赖。
 * 用途：每次返回默认值前 clone，确保调用方修改不会污染 DEFAULTS。
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 校验 key 名是否合法，避免调用方拼错 key 导致污染未知字段
 */
function assertKey(name) {
  if (!(name in KEYS)) {
    console.warn(`[storage] unknown key: ${String(name)}, available: ${Object.keys(KEYS).join(', ')}`)
    return false
  }
  return true
}

/**
 * 读取数据
 * - 无记录 → 返回默认值的深拷贝
 * - JSON 损坏 → 返回默认值的深拷贝（不抛错）
 * - 类型与期望不符（如期望数组但解析出对象）→ 回退默认值
 * @param {string} name KEYS 中的字段名（如 'config' / 'tasks'）
 * @returns {*} 数据副本；非法 key 返回 null
 */
function read(name) {
  if (!assertKey(name)) return null
  try {
    const raw = localStorage.getItem(KEYS[name])
    if (raw === null) {
      // 首次使用或被清空：返回默认值副本
      return clone(DEFAULTS[name])
    }
    const parsed = JSON.parse(raw)
    // 类型守护：期望数组但实际非数组（用户篡改为对象/字符串）→ 回退
    if (Array.isArray(DEFAULTS[name]) && !Array.isArray(parsed)) {
      return clone(DEFAULTS[name])
    }
    return parsed
  } catch (e) {
    // JSON 损坏 / Storage 不可读：静默回退默认值，不让页面崩
    console.warn(`[storage] read ${name} failed, fallback to default`, e)
    return clone(DEFAULTS[name])
  }
}

/**
 * 写入数据
 * - 序列化失败 / quota 超限 / 隐私模式禁用 → 仅告警 + 返回 false
 * - 不抛异常，保证 UI 流程不被存储层阻断
 * @param {string} name KEYS 中的字段名
 * @param {*} value 任意可序列化数据
 * @returns {boolean} 是否写入成功
 */
function write(name, value) {
  if (!assertKey(name)) return false
  try {
    localStorage.setItem(KEYS[name], JSON.stringify(value))
    return true
  } catch (e) {
    console.warn(`[storage] write ${name} failed`, e)
    return false
  }
}

/**
 * 离线操作入队（仅 pending 专用）
 * - 读出当前队列 → push 新操作 → 截断到 MAX_PENDING → 回写
 * - 截断策略：保留最新 MAX_PENDING 条，最老的从队首丢弃
 * @param {*} operation 待同步的操作对象（结构由调用方约定）
 * @returns {boolean} 是否入队成功
 */
function enqueue(operation) {
  let queue = read('pending')
  if (!Array.isArray(queue)) {
    // 防御：极端情况下 pending 被篡改为非数组，重置为空
    queue = []
  }
  queue.push(operation)
  if (queue.length > MAX_PENDING) {
    queue.splice(0, queue.length - MAX_PENDING)
  }
  return write('pending', queue)
}

export { read, write, enqueue, KEYS }
