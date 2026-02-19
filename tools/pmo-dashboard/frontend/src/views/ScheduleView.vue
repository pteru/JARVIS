<template>
  <div class="page-container">
    <div class="page-header">
      <div class="flex-row">
        <router-link :to="`/projects/${code}`" class="back-link">
          <i class="pi pi-arrow-left"></i>
        </router-link>
        <div>
          <h1>Schedule</h1>
          <p>Project {{ code }}</p>
        </div>
      </div>
      <div class="flex-row gap-2 mt-2">
        <Button
          label="Add Task"
          icon="pi pi-plus"
          size="small"
          @click="showTaskDialog = true"
        />
      </div>
    </div>

    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <template v-else>
      <div v-if="milestones.length > 0" class="milestones-bar mb-3">
        <div v-for="ms in milestones" :key="ms.milestone_id" class="milestone-item">
          <div class="milestone-marker" :class="`status-${ms.status}`"></div>
          <div>
            <div class="milestone-name">{{ ms.name }}</div>
            <div class="milestone-date">{{ ms.target_date }}</div>
          </div>
        </div>
      </div>

      <GanttChart
        v-if="tasks.length > 0"
        :tasks="ganttTasks"
        @task-click="onTaskClick"
        @task-date-change="onTaskDateChange"
      />

      <div v-else class="empty-state">
        <i class="pi pi-calendar"></i>
        <p>No schedule tasks defined yet</p>
      </div>
    </template>

    <!-- Task Dialog -->
    <Dialog
      v-model:visible="showTaskDialog"
      :header="editingTask ? 'Edit Task' : 'Add Task'"
      modal
      :style="{ width: '520px' }"
    >
      <div class="form-grid">
        <div class="form-field">
          <label>Task ID *</label>
          <InputText v-model="taskForm.task_id" placeholder="e.g. acq1" class="w-full" :disabled="!!editingTask" />
        </div>
        <div class="form-field">
          <label>Name *</label>
          <InputText v-model="taskForm.name" class="w-full" />
        </div>
        <div class="form-field">
          <label>Category</label>
          <Select
            v-model="taskForm.category"
            :options="categoryOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Select category"
            class="w-full"
          />
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>Start Date</label>
            <DatePicker v-model="taskForm.start_date" dateFormat="yy-mm-dd" showIcon class="w-full" />
          </div>
          <div class="form-field">
            <label>End Date</label>
            <DatePicker v-model="taskForm.end_date" dateFormat="yy-mm-dd" showIcon class="w-full" />
          </div>
        </div>
        <div class="form-field">
          <label>Status</label>
          <Select
            v-model="taskForm.status"
            :options="statusOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>
        <div class="form-field">
          <label>Assignee</label>
          <InputText v-model="taskForm.assignee" class="w-full" />
        </div>
        <div class="form-field">
          <label>Supplier</label>
          <InputText v-model="taskForm.supplier" class="w-full" />
        </div>
        <div class="form-field">
          <label>Notes</label>
          <Textarea v-model="taskForm.notes" rows="2" class="w-full" />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="closeTaskDialog" />
        <Button :label="editingTask ? 'Update' : 'Create'" @click="saveTask" />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import { getSchedule, createTask, updateTask } from '../api.js'
import GanttChart from '../components/GanttChart.vue'

const props = defineProps({
  code: { type: String, required: true }
})

const loading = ref(true)
const tasks = ref([])
const milestones = ref([])
const showTaskDialog = ref(false)
const editingTask = ref(null)

const taskForm = ref({
  task_id: '',
  name: '',
  category: null,
  start_date: null,
  end_date: null,
  status: 'pending',
  assignee: '',
  supplier: '',
  notes: ''
})

const categoryOptions = [
  { label: 'Design', value: 'design' },
  { label: 'Procurement', value: 'procurement' },
  { label: 'Manufacturing', value: 'manufacturing' },
  { label: 'Installation', value: 'installation' },
  { label: 'Commissioning', value: 'commissioning' }
]

const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Delayed', value: 'delayed' },
  { label: 'Cancelled', value: 'cancelled' }
]

const ganttTasks = computed(() => {
  return tasks.value.map(t => ({
    id: t.task_id,
    name: t.name,
    start: t.start_date,
    end: t.end_date,
    progress: t.status === 'completed' ? 100 : t.status === 'in_progress' ? 50 : 0,
    dependencies: t.depends_on ? (typeof t.depends_on === 'string' ? JSON.parse(t.depends_on) : t.depends_on).join(', ') : '',
    custom_class: `task-${t.status || 'pending'}`
  })).filter(t => t.start && t.end)
})

function onTaskClick(task) {
  const original = tasks.value.find(t => t.task_id === task.id)
  if (original) {
    editingTask.value = original
    taskForm.value = {
      task_id: original.task_id,
      name: original.name,
      category: original.category,
      start_date: original.start_date ? new Date(original.start_date) : null,
      end_date: original.end_date ? new Date(original.end_date) : null,
      status: original.status,
      assignee: original.assignee || '',
      supplier: original.supplier || '',
      notes: original.notes || ''
    }
    showTaskDialog.value = true
  }
}

async function onTaskDateChange(task, start, end) {
  try {
    await updateTask(props.code, task.id, {
      start_date: start,
      end_date: end
    })
    await loadSchedule()
  } catch (err) {
    console.error('Failed to update task dates:', err)
  }
}

function closeTaskDialog() {
  showTaskDialog.value = false
  editingTask.value = null
  taskForm.value = {
    task_id: '',
    name: '',
    category: null,
    start_date: null,
    end_date: null,
    status: 'pending',
    assignee: '',
    supplier: '',
    notes: ''
  }
}

function formatDate(d) {
  if (!d) return null
  if (d instanceof Date) return d.toISOString().split('T')[0]
  return d
}

async function saveTask() {
  const payload = {
    ...taskForm.value,
    start_date: formatDate(taskForm.value.start_date),
    end_date: formatDate(taskForm.value.end_date)
  }
  try {
    if (editingTask.value) {
      await updateTask(props.code, editingTask.value.task_id, payload)
    } else {
      await createTask(props.code, payload)
    }
    closeTaskDialog()
    await loadSchedule()
  } catch (err) {
    console.error('Failed to save task:', err)
  }
}

async function loadSchedule() {
  loading.value = true
  try {
    const data = await getSchedule(props.code)
    tasks.value = data.tasks || []
    milestones.value = data.milestones || []
  } catch (err) {
    console.error('Failed to load schedule:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadSchedule()
})
</script>

<style scoped>
.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.back-link:hover {
  background-color: var(--color-bg-card);
  color: var(--color-text-primary);
}

.milestones-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.milestone-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.milestone-marker {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.milestone-marker.status-on_track {
  background-color: var(--color-success);
}

.milestone-marker.status-at_risk {
  background-color: var(--color-warning);
}

.milestone-marker.status-delayed {
  background-color: var(--color-danger);
}

.milestone-marker.status-completed {
  background-color: var(--color-accent);
}

.milestone-name {
  font-size: 0.85rem;
  font-weight: 600;
}

.milestone-date {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-field label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.35rem;
  color: var(--color-text-secondary);
}

.w-full {
  width: 100%;
}
</style>
