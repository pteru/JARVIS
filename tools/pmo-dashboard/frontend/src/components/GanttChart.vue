<template>
  <div class="gantt-wrapper">
    <div class="gantt-controls">
      <Button
        v-for="mode in viewModes"
        :key="mode"
        :label="mode"
        :severity="currentMode === mode ? undefined : 'secondary'"
        :outlined="currentMode !== mode"
        size="small"
        @click="changeViewMode(mode)"
      />
    </div>
    <div ref="ganttContainer" class="gantt-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import Button from 'primevue/button'

const props = defineProps({
  tasks: { type: Array, required: true }
})

const emit = defineEmits(['task-click', 'task-date-change'])

const ganttContainer = ref(null)
const currentMode = ref('Week')
const viewModes = ['Day', 'Week', 'Month']
let ganttInstance = null

function formatDate(dateStr) {
  if (!dateStr) return ''
  if (dateStr instanceof Date) return dateStr.toISOString().split('T')[0]
  return dateStr
}

async function initGantt() {
  if (!ganttContainer.value || props.tasks.length === 0) return

  try {
    const Gantt = (await import('frappe-gantt')).default

    // Clear previous instance
    ganttContainer.value.innerHTML = ''

    const ganttTasks = props.tasks.map(t => ({
      id: t.id,
      name: t.name,
      start: formatDate(t.start),
      end: formatDate(t.end),
      progress: t.progress || 0,
      dependencies: t.dependencies || '',
      custom_class: t.custom_class || ''
    }))

    ganttInstance = new Gantt(ganttContainer.value, ganttTasks, {
      view_mode: currentMode.value,
      date_format: 'YYYY-MM-DD',
      popup_trigger: 'click',
      on_click: (task) => {
        emit('task-click', task)
      },
      on_date_change: (task, start, end) => {
        emit('task-date-change', task, formatDate(start), formatDate(end))
      }
    })
  } catch (err) {
    console.error('Failed to initialize Gantt chart:', err)
    if (ganttContainer.value) {
      ganttContainer.value.innerHTML = '<div class="gantt-error">Failed to load Gantt chart. Make sure frappe-gantt is installed.</div>'
    }
  }
}

function changeViewMode(mode) {
  currentMode.value = mode
  if (ganttInstance) {
    try {
      ganttInstance.change_view_mode(mode)
    } catch {
      initGantt()
    }
  }
}

watch(() => props.tasks, async () => {
  await nextTick()
  initGantt()
}, { deep: true })

onMounted(() => {
  initGantt()
})

onUnmounted(() => {
  ganttInstance = null
})
</script>

<style scoped>
.gantt-wrapper {
  width: 100%;
}

.gantt-controls {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 1rem;
}

.gantt-container {
  width: 100%;
  overflow-x: auto;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.5rem;
}

.gantt-error {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}
</style>

<style>
/* Global dark theme overrides for frappe-gantt */
.gantt .grid-background {
  fill: var(--color-bg-card);
}

.gantt .grid-header {
  fill: var(--color-bg-secondary);
  stroke: var(--color-border);
}

.gantt .grid-row {
  fill: var(--color-bg-card);
}

.gantt .grid-row:nth-child(even) {
  fill: var(--color-bg-secondary);
}

.gantt .row-line {
  stroke: var(--color-border);
}

.gantt .tick {
  stroke: var(--color-border);
  stroke-dasharray: 4;
}

.gantt .today-highlight {
  fill: rgba(15, 155, 142, 0.1);
}

.gantt .bar {
  fill: var(--color-accent);
  stroke: none;
}

.gantt .bar-progress {
  fill: var(--color-accent-hover);
}

.gantt .bar-label {
  fill: #ffffff;
  font-size: 12px;
}

.gantt .bar-label.big {
  fill: var(--color-text-primary);
}

.gantt .lower-text, .gantt .upper-text {
  fill: var(--color-text-secondary);
  font-size: 12px;
}

.gantt .handle {
  fill: var(--color-accent-hover);
}

.gantt .arrow {
  fill: none;
  stroke: var(--color-text-secondary);
  stroke-width: 1.4;
}

/* Task status custom classes */
.gantt .task-pending .bar {
  fill: #6b7280;
}

.gantt .task-in_progress .bar {
  fill: #2563eb;
}

.gantt .task-completed .bar {
  fill: #27ae60;
}

.gantt .task-delayed .bar {
  fill: #e74c3c;
}

.gantt .task-cancelled .bar {
  fill: #9ca3af;
}

/* Gantt popup dark theme */
.gantt-container .popup-wrapper {
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.gantt-container .popup-wrapper .title {
  color: var(--color-text-primary);
}

.gantt-container .popup-wrapper .subtitle {
  color: var(--color-text-secondary);
}
</style>
