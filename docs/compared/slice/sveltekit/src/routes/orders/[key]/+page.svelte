<script>
  let { data } = $props();

  // The order's status, kept live: the server pushes it, and the steps follow.
  let pushed = $state(null);
  const reached = $derived(pushed ? data.order.steps.findIndex((one) => one.step === pushed) : data.order.steps.findLastIndex((one) => one.done));
  $effect(() => {
    const live = new EventSource(`/live/orders/${data.order.key}`);
    live.onmessage = (event) => (pushed = JSON.parse(event.data));
    return () => live.close();
  });
</script>

<svelte:head><title>Your order · {data.shop}</title></svelte:head>

<h1>Order for {data.order.when}</h1>
<p>For {data.order.name} · {data.order.total}</p>
<ol class="steps" aria-label="Where your order is">
  {#each data.order.steps as one, i (one.step)}
    <li class={{ done: i <= reached }}>{one.words}</li>
  {/each}
</ol>
<ul class="lines">
  {#each data.order.lines as line (line.item)}
    <li>{line.qty} × {line.name}</li>
  {/each}
</ul>
