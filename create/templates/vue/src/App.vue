<script setup>
import { ref } from 'vue';
// Imported into Vue, a component is a Vue component: v-model:count binds its two-way prop.
import HelloCounter from './components/hello-counter.zb';
import ZubraWelcome from './components/zubra-welcome.zb';
import ZubraExamples from './components/zubra-examples.zb';

const count = ref(0);
</script>

<template>
  <main>
    <ZubraWelcome heading="{{title}}" framework="Vue" />
    <section class="try">
      <HelloCounter v-model:count="count" label="Clicks" />
      <p>Vue sees <span id="seen">{{ count }}</span></p>
    </section>
    <ZubraExamples />
  </main>
</template>
