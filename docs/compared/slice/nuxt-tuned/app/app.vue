<script setup>
// One call per page: the shell fetches the page's view, and the page reads the same data.
const route = useRoute();
const { data } = await useFetch('/api/view', { query: { path: route.path, ...route.query }, key: 'view' });
</script>

<template>
  <header class="site-head">
    <a href="/">{{ data.shop }}</a>
    <nav aria-label="Site">
      <a href="/">Menu</a>
      <a href="/order">Your order{{ data.count ? ` (${data.count})` : '' }}</a>
    </nav>
  </header>
  <main><NuxtPage /></main>
</template>
