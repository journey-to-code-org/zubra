<script setup>
const { data } = await useFetch('/api/bag', { key: 'bag' });
</script>

<template>
  <header class="site-head">
    <a href="/">{{ data.shop }}</a>
    <nav aria-label="Site">
      <a href="/">Menu</a>
      <a href="/order">Your order{{ data.cart.count ? ` (${data.cart.count})` : '' }}</a>
    </nav>
  </header>
  <main><NuxtPage /></main>
</template>
