<template>
  <section class="stats-chart">
    <!-- 头部：标题独占一行，选择器另起一行，移动端不挤压标题 -->
    <div class="stats-chart__head">
      <h2 class="stats-chart__title">学习统计</h2>
      <div class="stats-chart__selectors">
        <!-- 时间范围切换 -->
        <div class="seg">
          <button
            class="seg-btn"
            :class="{ 'seg-btn--active': range === 'week' }"
            @click="emit('range-change', 'week')"
          >近 7 天</button>
          <button
            class="seg-btn"
            :class="{ 'seg-btn--active': range === 'month' }"
            @click="emit('range-change', 'month')"
          >近 30 天</button>
        </div>

        <!-- 图表类型切换 -->
        <div class="seg">
          <button
            v-for="t in TYPES"
            :key="t.value"
            class="seg-btn"
            :class="{ 'seg-btn--active': type === t.value }"
            @click="emit('type-change', t.value)"
          >{{ t.label }}</button>
        </div>
      </div>
    </div>

    <!-- 图表容器（始终保留 DOM，empty 时叠加提示） -->
    <div class="stats-chart__wrap">
      <div ref="chartRef" class="stats-chart__canvas"></div>
      <div v-if="isEmpty" class="stats-chart__empty">
        暂无学习数据，完成专注后会自动统计
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

// 按需注册：仅打包用到的模块
// - bar/line/area 用 GridComponent；pie 用 LegendComponent
// - area = line + areaStyle，复用 LineChart，无需额外模块
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer
])

const props = defineProps({
  data: { type: Array, default: () => [] },
  range: { type: String, default: 'week' },
  isEmpty: { type: Boolean, default: false },
  type: { type: String, default: 'bar' }
})

const emit = defineEmits(['range-change', 'type-change'])

const TYPES = [
  { value: 'bar', label: '柱状图' },
  { value: 'line', label: '折线图' },
  { value: 'area', label: '面积图' },
  { value: 'pie', label: '环形图' }
]

const chartRef = ref(null)
// ECharts 实例用普通变量持有，不用 ref
// 原因：实例是带内部状态的大型对象，ref 会让 Vue 深度代理其所有字段，
// 造成 1) 性能开销 2) ECharts 内部方法可能因代理 this 错乱而报错
let chartInstance = null
let resizeObserver = null

/* ============================================================
 * 构建 ECharts option：按 type 分两族
 * - 笛卡尔族（bar/line/area）：共用 grid + xAxis + yAxis + axis tooltip
 * - 饼图族（pie）：无坐标轴，item tooltip + 可滚动 legend
 *
 * 饼图约束：
 * - 只展示 studyTime > 0 的日期（全 0 时无切片，配合 isEmpty 蒙层）
 * - tooltip 展示 日期 / 分钟数 / 占比
 * - 30 天 legend 用 type:'scroll' 分页，避免 30 项挤爆
 * ============================================================ */
function buildOption(data) {
  const isMonth = props.range === 'month'
  const t = props.type

  // -------- 饼图族 --------
  if (t === 'pie') {
    // 只取 studyTime > 0 的日期作为切片
    const pieData = data
      .filter((d) => Number(d.studyTime) > 0)
      .map((d) => ({ name: d.date, value: Number(d.studyTime) }))
    const total = pieData.reduce((s, x) => s + x.value, 0)
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          // p.value=分钟数，p.name=日期，占比由 value/total 计算
          const pct = total ? ((p.value / total) * 100).toFixed(1) : '0.0'
          return `${p.name}<br/>专注 ${p.value} 分钟<br/>占比 ${pct}%`
        }
      },
      legend: {
        // 30 天项数多 → scroll 分页；7 天 plain 即可
        type: isMonth ? 'scroll' : 'plain',
        orient: 'horizontal',
        bottom: 0,
        left: 'center',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11 }
      },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'], // 环形（中空）
          center: ['50%', '46%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          data: pieData
        }
      ]
    }
  }

  // -------- 笛卡尔族（bar / line / area）--------
  const color = '#ff6b6b'
  const values = data.map((d) => Number(d.studyTime) || 0)
  let series
  if (t === 'bar') {
    series = {
      type: 'bar',
      data: values,
      itemStyle: { color, borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 28
    }
  } else if (t === 'line') {
    series = {
      type: 'line',
      data: values,
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      itemStyle: { color },
      lineStyle: { color, width: 2 }
    }
  } else {
    // area = line + areaStyle
    series = {
      type: 'line',
      data: values,
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      itemStyle: { color },
      lineStyle: { color, width: 2 },
      areaStyle: { color: 'rgba(255,107,107,0.18)' }
    }
  }

  return {
    grid: { left: 44, right: 16, top: 16, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = params[0]
        return `${p.axisValue}<br/>专注 ${p.value} 分钟`
      }
    },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.date.slice(5)), // MM-DD
      axisLabel: {
        // 30 天：每 5 天显示一个，避免重叠
        interval: isMonth ? 4 : 'auto'
      },
      axisTick: { alignWithLabel: true }
    },
    yAxis: {
      type: 'value',
      name: '分钟',
      nameTextStyle: { color: '#9aa5b1' },
      axisLabel: { color: '#9aa5b1' },
      splitLine: { lineStyle: { color: '#f0f2f5' } }
    },
    series: [series]
  }
}

/** 用最新 data + type setOption 重绘 */
function render() {
  if (!chartInstance || !props.data.length) return
  // setOption 第二参数 true = notMerge，全量替换
  // 切换图表类型时旧 series（如 bar）必须清掉，否则 line 会和 bar 叠加
  chartInstance.setOption(buildOption(props.data), true)
}

onMounted(() => {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value)
  render()

  // ResizeObserver：监听容器尺寸变化（手机端旋转、父布局变化等）
  // ECharts 自带的 window.resize 监听不到"容器尺寸变化但窗口未 resize"的场景
  resizeObserver = new ResizeObserver(() => {
    chartInstance && chartInstance.resize()
  })
  resizeObserver.observe(chartRef.value)
})

/**
 * 同时监听 data 和 type：任一变化都重绘
 * - data 变化：聚合后新数据落盘 → 画新柱子
 * - type 变化：bar→pie 切换 → 换 series 类型
 * - nextTick：等 Vue 完成 DOM 更新后再 setOption（尺寸同步）
 */
watch(
  [() => props.data, () => props.type],
  () => {
    nextTick(render)
  }
)

onBeforeUnmount(() => {
  // 卸载清理：断开 observer + dispose 实例，防止内存泄漏
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})
</script>

<style scoped>
/* 卡片化：与其它模块统一视觉 */
.stats-chart {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--shadow-xs);
  text-align: left;
  min-width: 0;
}

/* 头部：标题 + 选择器，flex-wrap 保证移动端选择器换行不挤压标题 */
.stats-chart__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-md);
}
.stats-chart__title {
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
  flex: 1 1 auto;
}

/* 选择器组：范围 + 类型，自身也可换行 */
.stats-chart__selectors {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  flex: 1 1 auto;
  justify-content: flex-end;
}

/* 分段按钮组（范围 / 类型复用同一样式） */
.seg {
  display: inline-flex;
  gap: 4px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 4px;
}
.seg-btn {
  border: none;
  background: transparent;
  padding: 8px 12px;
  border-radius: var(--radius-pill);
  font-size: var(--font-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.seg-btn:hover:not(.seg-btn--active) {
  color: var(--color-text);
}
.seg-btn--active {
  background: var(--color-primary);
  color: #fff;
}

/* 图表容器：始终保留 DOM，empty 时叠加提示 */
.stats-chart__wrap {
  position: relative;
  min-width: 0; /* 防止内部 canvas/echarts 撑破父容器 */
}
.stats-chart__canvas {
  width: 100%;
  height: 240px;
  min-width: 0;
}
.stats-chart__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--font-sm);
  background: var(--color-surface);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

/* 手机端：标题与选择器各占整行，彻底避免挤压；按钮可触摸 */
@media (max-width: 640px) {
  .stats-chart {
    padding: var(--space-md);
  }
  .stats-chart__canvas {
    height: 220px;
  }
  .stats-chart__head {
    flex-direction: column;
    align-items: stretch;
  }
  .stats-chart__selectors {
    justify-content: flex-start;
  }
  .seg-btn {
    min-height: 40px;
    padding: 8px 12px;
  }
}
</style>
