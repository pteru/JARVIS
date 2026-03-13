<template>
  <div>
    <div class="page-header">
      <h1>Analytics</h1>
    </div>

    <div v-if="loading" class="loading-container">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
    </div>

    <div v-else-if="error" class="error-message">
      <i class="pi pi-exclamation-triangle"></i> {{ error }}
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="stat-cards">
        <div class="stat-card">
          <div class="label">Total Reviews</div>
          <div class="value">{{ data.total_reviews }}</div>
        </div>
        <div class="stat-card">
          <div class="label">Approval Rate</div>
          <div class="value">{{ approvalRate }}%</div>
        </div>
        <div class="stat-card">
          <div class="label">Avg Reviews / Day</div>
          <div class="value">{{ avgPerDay }}</div>
        </div>
      </div>

      <!-- Charts -->
      <div class="chart-grid">
        <div class="chart-card">
          <h3>Verdict Distribution</h3>
          <div class="chart-wrapper">
            <canvas ref="verdictChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <h3>Size Distribution</h3>
          <div class="chart-wrapper">
            <canvas ref="sizeChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <h3>Reviews per Day (Last 30 Days)</h3>
          <div class="chart-wrapper">
            <canvas ref="dailyChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <h3>Reviews by Product</h3>
          <div class="chart-wrapper">
            <canvas ref="productChart"></canvas>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import Chart from 'chart.js/auto';
import api from '../api.js';

const loading = ref(true);
const error = ref(null);
const data = ref({});

const verdictChart = ref(null);
const sizeChart = ref(null);
const dailyChart = ref(null);
const productChart = ref(null);

// Store chart instances for cleanup
const chartInstances = [];

const approvalRate = computed(() => {
  if (!data.value.total_reviews) return 0;
  const vd = data.value.verdict_distribution || {};
  const approvals = (vd.approve || 0) + (vd.approve_with_comments || 0);
  return Math.round((approvals / data.value.total_reviews) * 100);
});

const avgPerDay = computed(() => {
  if (!data.value.reviews_per_day || !data.value.reviews_per_day.length) return '0';
  const total = data.value.reviews_per_day.reduce((sum, d) => sum + d.count, 0);
  const days = data.value.reviews_per_day.length;
  return (total / days).toFixed(1);
});

// Chart.js defaults for dark theme
Chart.defaults.color = '#a0a0a0';
Chart.defaults.borderColor = '#333';

function createCharts() {
  // Clean up previous instances
  chartInstances.forEach((c) => c.destroy());
  chartInstances.length = 0;

  const vd = data.value.verdict_distribution || {};
  const sd = data.value.size_distribution || {};
  const rpd = data.value.reviews_per_day || [];
  const pp = data.value.per_product || [];

  // Verdict pie chart
  if (verdictChart.value) {
    const ctx = verdictChart.value.getContext('2d');
    chartInstances.push(
      new Chart(ctx, {
        type: 'pie',
        data: {
          labels: ['Approve', 'Approve w/ Comments', 'Changes Requested'],
          datasets: [
            {
              data: [vd.approve || 0, vd.approve_with_comments || 0, vd.changes_requested || 0],
              backgroundColor: ['#22c55e', '#c5b822', '#ef4444'],
              borderColor: '#252525',
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 16 } },
          },
        },
      })
    );
  }

  // Size doughnut chart
  if (sizeChart.value) {
    const ctx = sizeChart.value.getContext('2d');
    chartInstances.push(
      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Simple', 'Medium', 'Complex'],
          datasets: [
            {
              data: [sd.simple || 0, sd.medium || 0, sd.complex || 0],
              backgroundColor: ['#22c55e', '#eab308', '#ef4444'],
              borderColor: '#252525',
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 16 } },
          },
        },
      })
    );
  }

  // Daily bar chart
  if (dailyChart.value) {
    const ctx = dailyChart.value.getContext('2d');
    chartInstances.push(
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: rpd.map((d) => {
            // Show short date (MM/DD)
            const parts = d.date.split('-');
            return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d.date;
          }),
          datasets: [
            {
              label: 'Reviews',
              data: rpd.map((d) => d.count),
              backgroundColor: 'rgba(96, 165, 250, 0.6)',
              borderColor: '#60a5fa',
              borderWidth: 1,
              borderRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1 },
              grid: { color: '#2a2a2a' },
            },
            x: {
              grid: { display: false },
              ticks: {
                maxRotation: 45,
                autoSkip: true,
                maxTicksLimit: 15,
              },
            },
          },
        },
      })
    );
  }

  // Product bar chart
  if (productChart.value) {
    const ctx = productChart.value.getContext('2d');
    const colors = ['#60a5fa', '#22c55e', '#eab308', '#ef4444', '#a855f7'];
    chartInstances.push(
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: pp.map((p) => p.name),
          datasets: [
            {
              label: 'Reviews',
              data: pp.map((p) => p.count),
              backgroundColor: pp.map((_, i) => colors[i % colors.length]),
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { stepSize: 1 },
              grid: { color: '#2a2a2a' },
            },
            y: {
              grid: { display: false },
            },
          },
        },
      })
    );
  }
}

async function fetchAnalytics() {
  try {
    const res = await api.get('/analytics');
    data.value = res.data;
    error.value = null;
    await nextTick();
    createCharts();
  } catch (e) {
    error.value = `Failed to load analytics: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchAnalytics);
</script>
