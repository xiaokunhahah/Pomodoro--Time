<template>
  <section class="clock-panel">
    <h2 class="clock-panel__title">每日打卡</h2>

    <!-- 今日卡片 + 打卡按钮 -->
    <div class="today-card">
      <div class="today-card__info">
        <div class="today-card__date">{{ today }}</div>
        <div class="today-card__minutes">今日专注 {{ todayStudyMinutes }} 分钟</div>
      </div>
      <button
        class="btn"
        :class="hasClockedToday ? 'btn--done' : 'btn--primary'"
        :disabled="hasClockedToday || submitting"
        @click="emit('clock-in')"
      >
        {{ hasClockedToday ? '今日已打卡' : submitting ? '打卡中…' : '打卡' }}
      </button>
    </div>

    <!-- 重复点击提示（轻量 toast，不弹窗） -->
    <p v-if="toast" class="clock-panel__toast">{{ toast }}</p>

    <!-- 连续打卡天数 -->
    <div class="streak">
      <span class="streak__label">连续打卡</span>
      <strong class="streak__num">{{ streak }}</strong>
      <span class="streak__label">天</span>
    </div>

    <!-- 最近 14 天日历（7 列 x 2 行） -->
    <div class="calendar">
      <div
        v-for="d in recent14"
        :key="d.date"
        class="day"
        :class="{
          'day--clocked': d.isClocked,
          'day--today': d.date === today
        }"
        :title="d.date + (d.isClocked ? ` · ${d.studyTime} 分钟` : ' · 未打卡')"
      >
        <div class="day__num">{{ d.date.slice(8) }}</div>
        <div class="day__sub">{{ d.date.slice(5, 7) }}/{{ d.date.slice(8) }}</div>
      </div>
    </div>
  </section>
</template>

<script setup>
defineProps({
  today: { type: String, required: true },
  todayStudyMinutes: { type: Number, default: 0 },
  hasClockedToday: { type: Boolean, default: false },
  recent14: { type: Array, default: () => [] },
  streak: { type: Number, default: 0 },
  toast: { type: String, default: '' },
  // 打卡进行中：禁用按钮，防连点重入导致同日重复打卡
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['clock-in'])
</script>

<style scoped>
/* 卡片化：与左栏 timer-zone 视觉对称 */
.clock-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--shadow-xs);
  text-align: left;
  min-width: 0;
}
.clock-panel__title {
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 var(--space-md);
}

/* 今日卡片：去独立边框，靠底部分隔线区分 */
.today-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0 0 var(--space-md);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-md);
  min-width: 0;
}
.today-card__info {
  min-width: 0;
}
.today-card__date {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--color-text);
}
.today-card__minutes {
  font-size: var(--font-xs);
  color: var(--color-text-muted);
  margin-top: 4px;
}

/* 已打卡态按钮：用全局 .btn 基础 + 覆盖样式 */
.btn--done {
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
  border-color: var(--color-border);
  cursor: not-allowed;
}

/* 重复点击 toast */
.clock-panel__toast {
  color: var(--color-primary-dark);
  font-size: var(--font-sm);
  margin: 0 0 var(--space-md);
  text-align: right;
  transition: opacity 0.2s;
}

/* 连续天数 */
.streak {
  text-align: center;
  margin-bottom: var(--space-md);
}
.streak__label {
  font-size: var(--font-sm);
  color: var(--color-text-muted);
}
.streak__num {
  font-size: var(--font-xl);
  font-weight: 700;
  color: var(--color-primary);
  margin: 0 6px;
  font-variant-numeric: tabular-nums;
}

/* 14 天日历：7 列网格，自适应宽度 */
.calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
.day {
  aspect-ratio: 1;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: var(--font-xs);
  color: var(--color-text-muted);
  transition: background 0.2s, color 0.2s;
  cursor: default;
  min-width: 0;
  overflow: hidden;
}
.day--clocked {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
/* 今日：用 box-shadow 加边框，避免 border 2px 导致布局抖动 */
.day--today {
  box-shadow: 0 0 0 2px var(--color-primary);
}
.day__num {
  font-size: var(--font-md);
  font-weight: 600;
}
.day__sub {
  font-size: 10px;
  opacity: 0.7;
  margin-top: 2px;
}

/* 手机端：日历格子缩小 */
@media (max-width: 640px) {
  .calendar {
    gap: 4px;
  }
  .day__num {
    font-size: var(--font-sm);
  }
  .day__sub {
    font-size: 9px;
  }
  .clock-panel {
    padding: var(--space-md);
  }
}
</style>
