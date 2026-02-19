<template>
  <div class="app-layout">
    <header class="app-navbar">
      <div class="navbar-inner">
        <div class="navbar-left">
          <router-link to="/" class="navbar-brand">
            <i class="pi pi-briefcase"></i>
            <span>PMO Dashboard</span>
          </router-link>
          <nav class="navbar-links">
            <router-link to="/" class="nav-link" active-class="nav-link-active">
              <i class="pi pi-th-large"></i>
              Projects
            </router-link>
            <router-link to="/suppliers" class="nav-link" active-class="nav-link-active">
              <i class="pi pi-building"></i>
              Suppliers
            </router-link>
          </nav>
        </div>
        <div class="navbar-center">
          <SearchBar />
        </div>
        <div class="navbar-right">
          <AlertBell />
        </div>
      </div>
    </header>
    <main class="app-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import SearchBar from './components/SearchBar.vue'
import AlertBell from './components/AlertBell.vue'
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-navbar {
  background-color: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 1000;
}

.navbar-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.navbar-left {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-accent);
  text-decoration: none;
}

.navbar-brand:hover {
  color: var(--color-accent-hover);
}

.navbar-links {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem;
  border-radius: 6px;
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.15s ease;
}

.nav-link:hover {
  background-color: var(--color-bg-card);
  color: var(--color-text-primary);
}

.nav-link-active {
  background-color: var(--color-bg-card);
  color: var(--color-accent);
}

.navbar-center {
  flex: 1;
  max-width: 420px;
}

.navbar-right {
  display: flex;
  align-items: center;
}

.app-content {
  flex: 1;
}
</style>
