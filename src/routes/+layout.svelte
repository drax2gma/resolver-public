<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="/">resolver<span>.</span>pilot</a>
    <span class="badge accent">SPA</span>
    <span class="spacer"></span>
    <span class="muted" style="font-size:.82rem">YAML router + SQLite tudás</span>
  </div>
</header>

<main class="wrap main">
  {@render children()}
</main>

<footer class="wrap" style="padding-bottom:2rem;color:var(--muted);font-size:.8rem">
  Anonim visszajelzés · a tudásbázis közös · nincs login
</footer>
