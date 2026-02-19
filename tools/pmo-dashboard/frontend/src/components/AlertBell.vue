<template>
  <div class="alert-bell-wrapper" ref="wrapperRef">
    <button class="bell-button" @click="togglePanel" :class="{ 'has-alerts': unreadCount > 0 }">
      <i class="pi pi-bell"></i>
      <span v-if="unreadCount > 0" class="bell-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>

    <div v-if="showPanel" class="alert-panel">
      <div class="panel-header">
        <span class="panel-title">Alerts</span>
        <span v-if="unreadCount > 0" class="unread-count">{{ unreadCount }} unread</span>
      </div>

      <div v-if="loading" class="panel-loading">
        <i class="pi pi-spin pi-spinner"></i>
      </div>

      <div v-else-if="alerts.length === 0" class="panel-empty">
        <i class="pi pi-check-circle"></i>
        <span>No alerts</span>
      </div>

      <div v-else class="alert-list">
        <div
          v-for="alert in alerts"
          :key="alert.id"
          class="alert-item"
          :class="{ unread: !alert.is_read, [`severity-${alert.severity}`]: true }"
        >
          <div class="alert-icon">
            <i :class="getSeverityIcon(alert.severity)"></i>
          </div>
          <div class="alert-content">
            <div class="alert-title">{{ alert.title }}</div>
            <div v-if="alert.message" class="alert-message">{{ alert.message }}</div>
            <div class="alert-meta">
              <span v-if="alert.project_code" class="alert-project">{{ alert.project_code }}</span>
              <span class="alert-time">{{ formatTime(alert.created_at) }}</span>
            </div>
          </div>
          <button class="dismiss-btn" @click.stop="handleDismiss(alert.id)" title="Dismiss">
            <i class="pi pi-times"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getAlerts, dismissAlert } from '../api.js'

const alerts = ref([])
const loading = ref(false)
const showPanel = ref(false)
const wrapperRef = ref(null)

const unreadCount = computed(() => {
  return alerts.value.filter(a => !a.is_read && !a.dismissed_at).length
})

function getSeverityIcon(severity) {
  const map = {
    critical: 'pi pi-exclamation-triangle',
    warning: 'pi pi-exclamation-circle',
    info: 'pi pi-info-circle'
  }
  return map[severity] || 'pi pi-bell'
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now - d
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHrs / 24)

    if (diffHrs < 1) return 'Just now'
    if (diffHrs < 24) return `${diffHrs}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

async function togglePanel() {
  showPanel.value = !showPanel.value
  if (showPanel.value) {
    await loadAlerts()
  }
}

async function loadAlerts() {
  loading.value = true
  try {
    alerts.value = await getAlerts({ unread_only: false })
  } catch (err) {
    console.error('Failed to load alerts:', err)
    alerts.value = []
  } finally {
    loading.value = false
  }
}

async function handleDismiss(id) {
  try {
    await dismissAlert(id)
    const alert = alerts.value.find(a => a.id === id)
    if (alert) {
      alert.is_read = true
      alert.dismissed_at = new Date().toISOString()
    }
  } catch (err) {
    console.error('Failed to dismiss alert:', err)
  }
}

function handleClickOutside(event) {
  if (wrapperRef.value && !wrapperRef.value.contains(event.target)) {
    showPanel.value = false
  }
}

let pollInterval = null

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  // Initial load for badge count
  loadAlerts()
  // Poll every 60 seconds
  pollInterval = setInterval(loadAlerts, 60000)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  if (pollInterval) clearInterval(pollInterval)
})
</script>

<style scoped>
.alert-bell-wrapper {
  position: relative;
}

.bell-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 1.1rem;
}

.bell-button:hover {
  background-color: var(--color-bg-card);
  color: var(--color-text-primary);
}

.bell-button.has-alerts {
  color: var(--color-warning);
}

.bell-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background-color: var(--color-danger);
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.alert-panel {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: 380px;
  max-height: 480px;
  background-color: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.panel-title {
  font-weight: 600;
  font-size: 0.95rem;
}

.unread-count {
  font-size: 0.8rem;
  color: var(--color-accent);
  font-weight: 500;
}

.panel-loading,
.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.alert-list {
  overflow-y: auto;
  max-height: 400px;
}

.alert-item {
  display: flex;
  gap: 0.65rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.1s ease;
}

.alert-item:last-child {
  border-bottom: none;
}

.alert-item:hover {
  background-color: var(--color-bg-secondary);
}

.alert-item.unread {
  background-color: rgba(15, 155, 142, 0.05);
}

.alert-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.severity-critical .alert-icon {
  color: var(--color-danger);
}

.severity-warning .alert-icon {
  color: var(--color-warning);
}

.severity-info .alert-icon {
  color: var(--color-accent);
}

.alert-content {
  flex: 1;
  min-width: 0;
}

.alert-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.alert-message {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 0.15rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.alert-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  margin-top: 0.25rem;
}

.alert-project {
  font-family: monospace;
  background-color: var(--color-bg-secondary);
  padding: 0 0.3rem;
  border-radius: 3px;
}

.dismiss-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  opacity: 0;
  transition: all 0.15s ease;
}

.alert-item:hover .dismiss-btn {
  opacity: 1;
}

.dismiss-btn:hover {
  background-color: var(--color-bg-card);
  color: var(--color-text-primary);
}
</style>
