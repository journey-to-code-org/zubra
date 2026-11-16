<script>
  // Svelte uses the element directly: props are set as properties, on<name> listens.
  import './components/hello-counter.zb';
  import './components/zubra-welcome.zb';
  import './components/zubra-examples.zb';

  let count = $state(0);
</script>

<main>
  <zubra-welcome heading="{{title}}" framework="Svelte"></zubra-welcome>
  <section class="try">
    <hello-counter {count} oncountchange={(event) => (count = event.detail)} label="Clicks"></hello-counter>
    <p>Svelte sees <span id="seen">{count}</span></p>
  </section>
  <zubra-examples></zubra-examples>
</main>
