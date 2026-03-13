<template>
  <div class="app-layout">
    <aside class="app-sidebar">
      <router-link to="/" class="logo">
        <i class="pi pi-code"></i>
        <span>PR Reviews</span>
      </router-link>
      <nav>
        <router-link to="/">
          <i class="pi pi-inbox"></i>
          <span>Inbox</span>
        </router-link>
        <router-link to="/pipeline">
          <i class="pi pi-sync"></i>
          <span>Pipeline</span>
        </router-link>
        <router-link to="/analytics">
          <i class="pi pi-chart-bar"></i>
          <span>Analytics</span>
        </router-link>
      </nav>
    </aside>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup>
</script>
