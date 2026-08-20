<template>
  <section class="task-list">
    <h2 class="task-list__title">学习任务</h2>

    <!-- 当前专注任务提示 -->
    <div v-if="currentTaskId" class="current-task">
      <span>当前专注：</span>
      <strong>{{ currentTaskContent }}</strong>
      <button class="link-btn" @click="emit('clear-current')">取消</button>
    </div>

    <!-- 新增任务 -->
    <div class="task-form">
      <input
        v-model="draft.content"
        class="input task-form__input"
        placeholder="任务名称（必填）"
        maxlength="50"
        @keyup.enter="onAdd"
      />
      <input
        v-model="draft.description"
        class="input task-form__input task-form__input--desc"
        placeholder="描述（可选）"
        maxlength="200"
      />
      <button class="btn btn--primary" :disabled="submitting" @click="onAdd">
        {{ submitting ? '添加中…' : '添加' }}
      </button>
    </div>
    <p v-if="addError" class="field__error">{{ addError }}</p>

    <!-- 任务列表 -->
    <ul v-if="tasks.length" class="task-items">
      <li
        v-for="t in tasks"
        :key="t.id"
        class="task-item"
        :class="{
          'task-item--done': t.status === '1',
          'task-item--current': t.id === currentTaskId
        }"
      >
        <!-- 显示态 -->
        <template v-if="editingId !== t.id">
          <label class="task-item__check">
            <input
              type="checkbox"
              :checked="t.status === '1'"
              @change="emit('toggle', t.id)"
            />
          </label>
          <div class="task-item__body">
            <div class="task-item__content">{{ t.content }}</div>
            <div v-if="t.description" class="task-item__desc">{{ t.description }}</div>
          </div>
          <div class="task-item__actions">
            <button
              v-if="t.status === '0'"
              class="link-btn"
              :class="{ 'link-btn--current': t.id === currentTaskId }"
              :disabled="t.id === currentTaskId"
              @click="emit('set-current', t.id)"
            >{{ t.id === currentTaskId ? '专注中' : '设为专注' }}</button>
            <button class="link-btn" @click="startEdit(t)">编辑</button>
            <button class="link-btn link-btn--danger" @click="emit('delete', t.id)">删除</button>
          </div>
        </template>

        <!-- 编辑态 -->
        <template v-else>
          <div class="task-edit">
            <input v-model="editDraft.content" class="input" placeholder="任务名称" maxlength="50" />
            <input v-model="editDraft.description" class="input" placeholder="描述（可选）" maxlength="200" />
            <div class="task-edit__actions">
              <button class="btn btn--primary" :disabled="submitting" @click="saveEdit(t.id)">保存</button>
              <button class="btn" @click="cancelEdit">取消</button>
            </div>
          </div>
          <p v-if="editError" class="field__error">{{ editError }}</p>
        </template>
      </li>
    </ul>
    <p v-else class="task-list__empty">暂无任务，添加一条开始吧</p>

    <!-- 清空全部 -->
    <div v-if="tasks.length" class="task-list__footer">
      <button class="btn btn--danger" @click="showClearConfirm = true">清空全部</button>
    </div>

    <!-- 清空确认弹窗 -->
    <div v-if="showClearConfirm" class="modal-mask" @click.self="showClearConfirm = false">
      <div class="modal">
        <h2 class="modal__title">清空全部任务？</h2>
        <p class="modal__hint">该操作不可撤销，将删除所有未完成和已完成任务。</p>
        <div class="modal__actions">
          <button class="btn" @click="showClearConfirm = false">取消</button>
          <button class="btn btn--danger" @click="confirmClear">确定清空</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  currentTaskId: { type: String, default: null },
  loading: { type: Boolean, default: false },
  // 写操作进行中：禁用添加/编辑按钮，防重复提交
  submitting: { type: Boolean, default: false }
})

// 输入长度上限（边界校验，与 useTask 一致）
const MAX_CONTENT = 50
const MAX_DESC = 200

const emit = defineEmits([
  'add',
  'toggle',
  'edit',
  'delete',
  'clear-all',
  'set-current',
  'clear-current'
])

// 当前专注任务内容（用于顶部提示）
const currentTaskContent = computed(() => {
  const t = props.tasks.find((x) => x.id === props.currentTaskId)
  return t ? t.content : ''
})

// 新增草稿
const draft = reactive({ content: '', description: '' })
const addError = ref('')

function onAdd() {
  const c = draft.content.trim()
  if (!c) {
    addError.value = '任务名称不能为空'
    return
  }
  if (c.length > MAX_CONTENT) {
    addError.value = `任务名称不超过 ${MAX_CONTENT} 字`
    return
  }
  if (draft.description.trim().length > MAX_DESC) {
    addError.value = `描述不超过 ${MAX_DESC} 字`
    return
  }
  addError.value = ''
  emit('add', { content: c, description: draft.description.trim() })
  draft.content = ''
  draft.description = ''
}

// 编辑态
const editingId = ref(null)
const editDraft = reactive({ content: '', description: '' })
const editError = ref('')

function startEdit(t) {
  editingId.value = t.id
  editDraft.content = t.content
  editDraft.description = t.description || ''
  editError.value = ''
}

function cancelEdit() {
  editingId.value = null
  editError.value = ''
}

function saveEdit(id) {
  const c = editDraft.content.trim()
  if (!c) {
    editError.value = '任务名称不能为空'
    return
  }
  if (c.length > MAX_CONTENT) {
    editError.value = `任务名称不超过 ${MAX_CONTENT} 字`
    return
  }
  if (editDraft.description.trim().length > MAX_DESC) {
    editError.value = `描述不超过 ${MAX_DESC} 字`
    return
  }
  editError.value = ''
  emit('edit', { id, content: c, description: editDraft.description.trim() })
  editingId.value = null
}

// 清空确认
const showClearConfirm = ref(false)
function confirmClear() {
  showClearConfirm.value = false
  emit('clear-all')
}
</script>

<style scoped>
/* 模块间距由父 App.vue 的 gap 统一控制，这里不再设 margin-top */
.task-list {
  text-align: left;
}
.task-list__title {
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 var(--space-md);
}

/* 当前专注任务提示 */
.current-task {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-primary-soft);
  border: 1px solid #ffd5d5;
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
  color: var(--color-text);
  margin-bottom: var(--space-md);
  min-width: 0;
}
.current-task strong {
  flex: 1;
  min-width: 0; /* 允许收缩，配合下面截断 */
  color: var(--color-primary);
  overflow-wrap: break-word; /* 超长任务名换行而非撑破 */
}

/* 新增表单 */
.task-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.task-form__input {
  width: 100%;
  min-width: 0;
}
.task-form .btn {
  align-self: flex-start;
}

/* 任务项 */
.task-items {
  list-style: none;
  padding: 0;
  margin: 0;
}
.task-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-sm);
  box-shadow: var(--shadow-xs);
  transition: border-color 0.2s, background 0.2s;
}
.task-item--current {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}
.task-item--done .task-item__content,
.task-item--done .task-item__desc {
  color: var(--color-text-muted);
  text-decoration: line-through;
}
.task-item__check {
  margin-top: 2px;
  cursor: pointer;
  flex-shrink: 0;
}
.task-item__body {
  flex: 1;
  min-width: 0;
}
.task-item__content {
  font-size: var(--font-md);
  color: var(--color-text);
  word-break: break-word;
}
.task-item__desc {
  margin-top: 4px;
  font-size: var(--font-xs);
  color: var(--color-text-muted);
  word-break: break-word;
}
.task-item__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* 编辑态 */
.task-edit {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
}
.task-edit__actions {
  display: flex;
  gap: var(--space-sm);
}

/* 链接式按钮 */
.link-btn {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-xs);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  transition: color 0.2s, background 0.2s;
}
.link-btn:hover:not(:disabled) {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}
.link-btn--current {
  color: var(--color-primary);
}
.link-btn--danger:hover:not(:disabled) {
  color: var(--color-primary-dark);
  background: var(--color-primary-soft);
}
.link-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 底部清空 */
.task-list__footer {
  margin-top: var(--space-md);
  text-align: right;
}
.task-list__empty {
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-sm);
  padding: var(--space-lg);
  background: var(--color-surface);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

/* ---- 桌面双栏：表单(左) + 列表(右)，标题/当前任务/底部跨整行 ---- */
@media (min-width: 851px) {
  .task-list {
    display: grid;
    grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
    grid-template-areas:
      "title   title"
      "current current"
      "form    list"
      "error   list"
      "footer  footer";
    gap: var(--space-md) var(--space-lg);
    align-items: start;
  }
  .task-list__title { grid-area: title; }
  .current-task { grid-area: current; }
  .task-form { grid-area: form; }
  .field__error { grid-area: error; }
  .task-items { grid-area: list; }
  .task-list__empty { grid-area: list; }
  .task-list__footer { grid-area: footer; }
  /* 模态遮罩 fixed 脱出流，占满网格避免挤其他项 */
  .modal-mask { grid-area: 1 / 1 / -1 / -1; }
}

/* ---- 手机 ≤640px：任务项操作按钮换行到第二行，避免溢出 ---- */
@media (max-width: 640px) {
  .task-item {
    flex-wrap: wrap;
  }
  .task-item__actions {
    width: 100%;
    justify-content: flex-end;
  }
  /* 文字按钮保证可触摸高度 */
  .link-btn {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
  }
}
</style>
