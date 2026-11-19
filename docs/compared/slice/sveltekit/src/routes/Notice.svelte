<script>
  let { said } = $props();
</script>

{#if said.problem}
  <p class="notice problem" role="alert">{said.problem}</p>
{:else if said.done}
  <p class="notice" role="status">{said.done}</p>
{/if}
