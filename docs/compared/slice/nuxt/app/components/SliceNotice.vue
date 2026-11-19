<script setup>
const route = useRoute();
const { data: said } = await useFetch('/api/said', { query: route.query, key: `said-${route.fullPath}` });
</script>

<template>
  <p v-if="said?.problem" class="notice problem" role="alert">{{ said.problem }}</p>
  <p v-else-if="said?.done" class="notice" role="status">{{ said.done }}</p>
</template>
