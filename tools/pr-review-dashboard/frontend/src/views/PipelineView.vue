<template>
  <div>
    <div class="page-header">
      <h1>Pipeline</h1>
      <button class="force-run-btn" @click="confirmForceRun" :disabled="actionLoading">
        <i class="pi pi-play"></i> Force Run
      </button>
    </div>

    <!-- Status cards -->
    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <template v-else>
      <div class="stat-cards">
        <div class="stat-card">
          <div class="label">Last Run</div>
          <div class="value" style="font-size: 1.1rem;">{{ formatDate(status.last_run) || 'Never' }}</div>
        </div>
        <div class="stat-card">
          <div class="label">Status</div>
          <div class="value">
            <span class="status-indicator" :class="statusClass">{{ status.last_status || 'Unknown' }}</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="label">Total Runs</div>
          <div class="value">{{ status.total_runs }}</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Reviews</div>
          <div class="value">{{ status.total_reviews }}</div>
        </div>
        <div class="stat-card">
          <div class="label">Last New Reviews</div>
          <div class="value">{{ status.last_new_reviews }}</div>
        </div>
      </div>

      <!-- Action feedback -->
      <div v-if="actionMessage" class="action-feedback" :class="{ success: actionSuccess, failure: !actionSuccess }" style="margin-bottom: 1rem;">
        {{ actionMessage }}
      </div>

      <!-- Log viewer -->
      <div style="margin-bottom: 1rem; display: flex; align-items: center; gap: 1rem;">
        <h2 style="margin: 0; font-size: 1.1rem;">Pipeline Logs</h2>
        <input
          v-model="logDate"
          type="date"
          class="date-input"
        />
        <button class="refresh-btn" @click="fetchLogs" :disabled="logsLoading">
          <i class="pi pi-refresh" :class="{ 'pi-spin': logsLoading }"></i> Refresh
        </button>
      </div>

      <div class="log-viewer" ref="logContainer">{{ logContent || 'No logs available.' }}</div>
    </template>

    <!-- Confirm dialog -->
    <ConfirmDialog
      :visible="showForceRunConfirm"
      title="Force Pipeline Run"
      message="This will trigger a full PR review pipeline run. Continue?"
      confirm-label="Run Now"
      severity="warning"
      @confirm="doForceRun"
      @cancel="showForceRunConfirm = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const loading = ref(true);
const status = ref({});
const logContent = ref('');
const logsLoading = ref(false);
const actionLoading = ref(false);
const actionMessage = ref('');
const actionSuccess = ref(false);
const showForceRunConfirm = ref(false);
const logContainer = ref(null);

// Default to today's date
const today = new Date().toISOString().slice(0, 10);
const logDate = ref(today);

const statusClass = computed(() => {
  const s = (status.value.last_status || '').toLowerCase();
  if (s === 'success') return 'status-success';
  if (s === 'partial') return 'status-partial';
  if (s === 'error' || s === 'failed') return 'status-error';
  return 'status-unknown';
});

async function fetchStatus() {
  try {
    const res = await api.get('/pipeline/status');
    status.value = res.data;
  } catch {
    status.value = {};
  } finally {
    loading.value = false;
  }
}

async function fetchLogs() {
  logsLoading.value = true;
  try {
    const res = await api.get('/pipeline/logs', {
      params: { lines: 200, log_date: logDate.value },
    });
    logContent.value = (res.data.lines || []).join('\n');
    // Auto-scroll to bottom
    if (logContainer.value) {
      setTimeout(() => {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      }, 50);
    }
  } catch {
    logContent.value = 'Failed to load logs.';
  } finally {
    logsLoading.value = false;
  }
}

function confirmForceRun() {
  showForceRunConfirm.value = true;
}

async function doForceRun() {
  showForceRunConfirm.value = false;
  actionLoading.value = true;
  actionMessage.value = '';
  try {
    const res = await api.post('/actions/pipeline/force-run');
    actionMessage.value = res.data.message || 'Pipeline run triggered';
    actionSuccess.value = res.data.success;
    // Refresh status after a delay
    setTimeout(fetchStatus, 3000);
  } catch (e) {
    actionMessage.value = e.response?.data?.detail || e.message;
    actionSuccess.value = false;
  } finally {
    actionLoading.value = false;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

onMounted(() => {
  fetchStatus();
  fetchLogs();
});
</script>

<style scoped>
.force-run-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid var(--primary-color);
  background-color: transparent;
  color: var(--primary-color);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s;
}

.force-run-btn:hover:not(:disabled) {
  background-color: rgba(96, 165, 250, 0.1);
}

.force-run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-indicator {
  font-size: 1rem;
  font-weight: 600;
  text-transform: capitalize;
}

.status-success { color: #22c55e; }
.status-partial { color: #eab308; }
.status-error { color: #ef4444; }
.status-unknown { color: #a0a0a0; }

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  border-radius: 5px;
  border: 1px solid #444;
  background-color: var(--surface-card);
  color: var(--text-color);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.refresh-btn:hover:not(:disabled) {
  background-color: var(--surface-overlay);
}

.date-input {
  padding: 0.35rem 0.5rem;
  border-radius: 5px;
  border: 1px solid #444;
  background-color: var(--surface-card);
  color: var(--text-color);
  font-size: 0.83rem;
  color-scheme: dark;
}

.action-feedback {
  padding: 0.6rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
}

.action-feedback.success {
  background-color: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.action-feedback.failure {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}
</style>
