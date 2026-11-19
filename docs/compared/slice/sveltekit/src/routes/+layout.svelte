<script>
  let { data, children } = $props();
</script>

<header class="site-head">
  <a href="/">{data.shop}</a>
  <nav aria-label="Site">
    <a href="/">Menu</a>
    <a href="/order">Your order{data.count ? ` (${data.count})` : ''}</a>
  </nav>
</header>
<main>{@render children()}</main>
