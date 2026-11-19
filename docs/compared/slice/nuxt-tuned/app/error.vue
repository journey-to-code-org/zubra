<script setup>
const props = defineProps({ error: Object });
useHead({ title: 'Not found', link: [{ rel: 'stylesheet', href: '/slice.css' }] });
</script>

<template>
  <main><h1>{{ props.error?.statusMessage || 'Something went wrong.' }}</h1></main>
</template>
