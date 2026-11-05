<script lang="ts">
  import { onMount } from 'svelte';
  import CodeEditor from '#lib/components/CodeEditor.svelte';
  import { parseTicketText } from '#lib/parse-ticket';
  import type {
    PublicSolver,
    RecommendationResponse,
    RouterResponse,
    RouterSourceSaveResponse,
    TicketInput,
    TicketListResponse
  } from '#lib/types';

  let view = $state<'pilot' | 'router'>('pilot');
  let routerData = $state<RouterResponse | null>(null);
  let sourceText = $state('');
  let sourceOriginal = $state('');
  let sourceHash = $state('');
  let editorDirty = $derived(sourceText !== sourceOriginal);
  let saving = $state(false);
  let editorError = $state<string | null>(null);
  let editorNotice = $state<string | null>(null);
  let tickets = $state<TicketInput[]>([]);
  let solvers = $state<PublicSolver[]>([]);
  let orgs = $state<string[]>([]);
  let selectedId = $state<string | null>(null);
  let selected = $derived(tickets.find((ticket) => ticket.externalId === selectedId) ?? null);
  let recommendation = $state<RecommendationResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let pasteText = $state('');
  let dragging = $state(false);
  let feedbackState = $state<'idle' | 'sending' | 'done'>('idle');
  let feedbackError = $state<string | null>(null);
  let showDown = $state(false);
  let suggestedSolverId = $state('');
  let suggestedOrg = $state('');
  let comment = $state('');
  let fileInput = $state<HTMLInputElement | undefined>(undefined);

  onMount(() => {
    const applyHash = () => {
      view = window.location.hash === '#router' ? 'router' : 'pilot';
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);

    void (async () => {
      await loadRouter();
    })();

    return () => window.removeEventListener('hashchange', applyHash);
  });

  async function loadRouter(): Promise<void> {
    try {
      const response = await fetch('/api/router');
      if (!response.ok) throw new Error(`Router API ${response.status}`);
      const data = (await response.json()) as RouterResponse;
      routerData = data;
      solvers = data.solvers;
      orgs = data.orgs;
      sourceText = data.source.content;
      sourceOriginal = data.source.content;
      sourceHash = data.source.hash;
    } catch (err) {
      error = `A router betöltése nem sikerült: ${(err as Error).message}`;
    }
  }

  function setView(next: 'pilot' | 'router') {
    view = next;
    const hash = next === 'router' ? '#router' : '#pilot';
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
  }

  function revertEditing() {
    sourceText = sourceOriginal;
    editorError = null;
    editorNotice = null;
  }

  async function saveEditing() {
    saving = true;
    editorError = null;
    editorNotice = null;
    try {
      const response = await fetch('/api/router/source', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: sourceText,
          baseHash: sourceHash
        })
      });
      const data = (await response.json().catch(() => null)) as
        | RouterSourceSaveResponse
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          (data && 'message' in data && data.message) || `API hiba (${response.status})`
        );
      }
      const result = data as RouterSourceSaveResponse;
      sourceOriginal = sourceText;
      sourceHash = result.hash;
      await loadRouter();
      editorNotice = result.warnings.length
        ? `Mentve. Figyelmeztetés: ${result.warnings.join(' ')}`
        : 'Mentve és validálva; a router azonnal érvényes.';
    } catch (err) {
      editorError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  function downloadEditing() {
    const blob = new Blob([sourceText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'router.yaml';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function addTicket(ticket: TicketInput) {
    const existing = tickets.findIndex((item) => item.externalId === ticket.externalId);
    if (existing >= 0) {
      tickets = tickets.map((item, index) => (index === existing ? ticket : item));
    } else {
      tickets = [...tickets, ticket];
    }
    selectTicket(ticket);
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.txt')) continue;
      const text = await file.text();
      if (!text.trim()) continue;
      addTicket(parseTicketText(text, file.name.replace(/\.txt$/i, '')));
    }
    if (fileInput) fileInput.value = '';
  }

  function addPasted() {
    const text = pasteText.trim();
    if (!text) return;
    const fallback = `PASTE-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '')}`;
    addTicket(parseTicketText(text, fallback));
    pasteText = '';
  }

  async function loadSamples() {
    error = null;
    try {
      const response = await fetch('/api/tickets');
      if (!response.ok) throw new Error(`Tickets API ${response.status}`);
      const data = (await response.json()) as TicketListResponse;
      for (const ticket of data.tickets) {
        if (!tickets.some((item) => item.externalId === ticket.externalId)) {
          tickets = [...tickets, ticket];
        }
      }
      if (!selectedId && data.tickets.length > 0) selectTicket(data.tickets[0]);
    } catch (err) {
      error = `A minta jegyek betöltése nem sikerült: ${(err as Error).message}`;
    }
  }

  function selectTicket(ticket: TicketInput) {
    selectedId = ticket.externalId;
    recommendation = null;
    error = null;
    feedbackState = 'idle';
    feedbackError = null;
    showDown = false;
    suggestedSolverId = '';
    suggestedOrg = '';
    comment = '';
  }

  async function askRecommendation() {
    if (!selected) return;
    loading = true;
    error = null;
    recommendation = null;
    feedbackState = 'idle';
    feedbackError = null;
    showDown = false;
    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: selected.rawText, filename: selected.externalId })
      });
      const data = (await response.json().catch(() => null)) as
        | RecommendationResponse
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          (data && 'message' in data && data.message) || `API hiba (${response.status})`
        );
      }
      recommendation = data as RecommendationResponse;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function sendFeedback(verdict: 'up' | 'down') {
    if (!selected || !recommendation) return;
    if (verdict === 'down') {
      if (!suggestedSolverId && !suggestedOrg) {
        feedbackError = 'Válassz megoldót vagy szervezetet.';
        return;
      }
      if (comment.trim().length < 5) {
        feedbackError = 'Írj legalább egy rövid indoklást (5 karakter).';
        return;
      }
    }
    feedbackState = 'sending';
    feedbackError = null;
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticketText: selected.rawText,
          primaryId: recommendation.primary.id,
          verdict,
          suggestedSolverId: verdict === 'down' ? suggestedSolverId || null : null,
          suggestedOrg: verdict === 'down' ? suggestedOrg || null : null,
          comment: verdict === 'down' ? comment.trim() : null
        })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message || `API hiba (${response.status})`);
      }
      feedbackState = 'done';
      showDown = false;
    } catch (err) {
      feedbackState = 'idle';
      feedbackError = (err as Error).message;
    }
  }

  function confidenceClass(value: number): string {
    if (value >= 0.72) return 'high';
    if (value >= 0.5) return 'mid';
    return 'low';
  }
</script>

<div class="view-tabs" role="tablist" aria-label="Nézet">
  <button
    type="button"
    role="tab"
    aria-selected={view === 'pilot'}
    class:active={view === 'pilot'}
    onclick={() => setView('pilot')}
  >Jegyek</button>
  <button
    type="button"
    role="tab"
    aria-selected={view === 'router'}
    class:active={view === 'router'}
    onclick={() => setView('router')}
  >Router</button>
</div>

{#if view === 'pilot'}
<div class="spa-grid">
  <section class="panel">
    <h1>Jegyek</h1>
    <p class="muted">
      Húzd ide a <code>.txt</code> jegyeket, illeszd be a szöveget, vagy töltsd be a
      mintákat. A javaslat a fix YAML routerből és a közös SQLite-tudásból jön.
    </p>

    <div
      class="dropzone"
      class:dragging
      role="button"
      tabindex="0"
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(event) => {
        event.preventDefault();
        dragging = false;
        void addFiles(event.dataTransfer?.files ?? null);
      }}
      onclick={() => fileInput?.click()}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') fileInput?.click();
      }}
    >
      <strong>Húzd ide a .txt jegyeket</strong>
      <span class="muted">vagy kattints a tallózáshoz</span>
      <input
        bind:this={fileInput}
        type="file"
        accept=".txt,text/plain"
        multiple
        hidden
        onchange={(event) => void addFiles(event.currentTarget.files)}
      />
    </div>

    <div class="stack" style="margin-top:.75rem">
      <label>
        Vagy illeszd be a jegy szövegét
        <textarea
          bind:value={pasteText}
          placeholder="Tárgy: ...&#10;Leírás: ..."
          rows="4"
        ></textarea>
      </label>
      <div class="row">
        <button type="button" onclick={addPasted} disabled={!pasteText.trim()}>
          Hozzáadás
        </button>
        <button type="button" onclick={loadSamples}>Minta jegyek</button>
      </div>
    </div>

    {#if error}
      <div class="error" style="margin-top:.75rem">{error}</div>
    {/if}

    <h2 style="margin-top:1.1rem">Felvett jegyek ({tickets.length})</h2>
    {#if tickets.length === 0}
      <p class="muted">Még nincs jegy. Húzz be egy fájlt, illessz be szöveget, vagy töltsd be a mintákat.</p>
    {:else}
      <ul class="ticket-list">
        {#each tickets as ticket (ticket.externalId)}
          <li>
            <button
              type="button"
              class:active={ticket.externalId === selectedId}
              onclick={() => selectTicket(ticket)}
            >
              <span class="row" style="gap:.35rem">
                <span class="badge">{ticket.externalId}</span>
                {#if ticket.prioritas}
                  <span class="badge" class:bad={ticket.prioritas === 'Kritikus'} class:warn={ticket.prioritas === 'Magas'}>
                    {ticket.prioritas}
                  </span>
                {/if}
              </span>
              <strong>{ticket.targy}</strong>
              <span class="muted">{ticket.kategoria ?? 'nincs kategória'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="panel">
    {#if selected}
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div class="row" style="gap:.35rem">
            <span class="badge">{selected.externalId}</span>
            {#if selected.prioritas}<span class="badge warn">{selected.prioritas}</span>{/if}
          </div>
          <h2 style="margin:.4rem 0 .2rem">{selected.targy}</h2>
          <div class="muted">
            {selected.kategoria ?? 'nincs kategória'}
            {#if selected.bejelento} · {selected.bejelento}{/if}
          </div>
        </div>
      </div>

      <details style="margin-top:.75rem">
        <summary>Jegy szövege</summary>
        <div class="ticket-text">{selected.leiras}</div>
      </details>

      <div class="row" style="margin-top:.85rem">
        <button class="primary" type="button" onclick={askRecommendation} disabled={loading}>
          {loading ? 'Elemzés…' : 'Javaslat kérése'}
        </button>
        {#if loading}
          <span class="muted"><span class="spinner" aria-hidden="true"></span>CPU-n az első hívás 40–60 s is lehet.</span>
        {/if}
      </div>

      {#if loading}
        <div class="notice" style="margin-top:.75rem" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          A modell elemzi a jegyet és a tanult eseteket…
        </div>
      {/if}

      {#if error}
        <div class="error" style="margin-top:.75rem">{error}</div>
      {/if}

      {#if recommendation}
        <div class="result">
          <div class="row" style="justify-content:space-between">
            <div>
              <div class="muted">Kinek</div>
              <h2 style="margin:.1rem 0">{recommendation.primary.nev}</h2>
              <div class="muted">
                {recommendation.primary.szervezet} · {recommendation.primary.szerep}
              </div>
            </div>
            <div style="text-align:right">
              <div class="muted">Biztonság</div>
              <div class="confidence" class:high={confidenceClass(recommendation.confidence) === 'high'} class:mid={confidenceClass(recommendation.confidence) === 'mid'} class:low={confidenceClass(recommendation.confidence) === 'low'}>
                {Math.round(recommendation.confidence * 100)}%
              </div>
            </div>
          </div>

          <h3 style="margin-top:1rem">Miért?</h3>
          <ul class="why-list">
            {#if recommendation.why.topics.length}
              <li>
                <strong>Témakör-egyezés:</strong>
                {recommendation.why.topics.map((topic) => topic.label).join(', ')}
              </li>
            {/if}
            {#if recommendation.why.solverTopics.length}
              <li>
                <strong>A megoldó profilja:</strong>
                {recommendation.why.solverTopics.join(', ')}
              </li>
            {/if}
            {#if recommendation.why.rules.length}
              <li>
                <strong>Alkalmazott szabály:</strong>
                {recommendation.why.rules.join(' ')}
              </li>
            {/if}
            {#each recommendation.why.examples.slice(0, 2) as example (example.text + example.verdict)}
              <li>
                <strong>Hasonló eset:</strong>
                {#if example.verdict === 'up'}
                  <span class="badge good">👍</span> {example.solver}
                {:else}
                  <span class="badge bad">👎</span>
                  {example.solver} helyett {example.suggested ?? 'más szervezet'}
                {/if}
                <span class="muted">— {example.text.slice(0, 160)}…</span>
              </li>
            {/each}
            <li><strong>Modell:</strong> {recommendation.why.model}</li>
          </ul>

          {#if recommendation.alternatives.length}
            <h3 style="margin-top:.9rem">Alternatívák</h3>
            <div class="stack" style="gap:.4rem">
              {#each recommendation.alternatives as alternative (alternative.id)}
                <div class="candidate">
                  <div>
                    <strong>{alternative.nev}</strong>
                    <div class="muted">{alternative.szervezet} · {alternative.szerep}</div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <div class="feedback-box">
            {#if feedbackState === 'done'}
              <div class="success">Köszönjük, a visszajelzés bekerült a közös tudásbázisba.</div>
            {:else}
              <h3>Releváns ez a javaslat?</h3>
              <p class="muted">Anonim visszajelzés. 👎 esetén add meg, kihez kellett volna kerülnie, és miért.</p>
              <div class="row">
                <button
                  class="good"
                  type="button"
                  onclick={() => sendFeedback('up')}
                  disabled={feedbackState === 'sending'}
                >👍 Releváns</button>
                <button
                  class="bad"
                  type="button"
                  onclick={() => (showDown = !showDown)}
                  disabled={feedbackState === 'sending'}
                >👎 Nem releváns</button>
              </div>

              {#if showDown}
                <div class="stack" style="margin-top:.65rem">
                  <label>
                    Kihez kellett volna kerülnie?
                    <select bind:value={suggestedSolverId}>
                      <option value="">— nem tudom, csak szervezet —</option>
                      {#each solvers.filter((solver) => solver.id !== (recommendation?.primary.id ?? '')) as solver (solver.id)}
                        <option value={solver.id}>{solver.nev} · {solver.szervezet}</option>
                      {/each}
                    </select>
                  </label>
                  <label>
                    Vagy legalább melyik szervezethez?
                    <select bind:value={suggestedOrg}>
                      <option value="">— nincs szervezet —</option>
                      {#each orgs as org (org)}
                        <option value={org}>{org}</option>
                      {/each}
                    </select>
                  </label>
                  <label>
                    Rövid indoklás (kötelező)
                    <textarea
                      bind:value={comment}
                      rows="3"
                      placeholder="Pl. ez AD Admin hatáskör, nem Windows Admin."
                    ></textarea>
                  </label>
                  <button
                    class="bad"
                    type="button"
                    onclick={() => sendFeedback('down')}
                    disabled={feedbackState === 'sending'}
                  >{feedbackState === 'sending' ? 'Küldés…' : 'Visszajelzés küldése'}</button>
                </div>
              {/if}
              {#if feedbackError}
                <div class="error" style="margin-top:.5rem">{feedbackError}</div>
              {/if}
            {/if}
          </div>

          <div class="muted" style="margin-top:.6rem;font-size:.78rem">
            {recommendation.model} · {recommendation.latencyMs} ms
          </div>
        </div>
      {/if}
    {:else}
      <div class="empty">
        <h2>Válassz jegyet</h2>
        <p>Bal oldalt húzz be egy .txt fájlt, illessz be szöveget, vagy töltsd be a mintákat.</p>
      </div>
    {/if}
  </section>
</div>
{:else}
  <section class="panel router-panel">
    <div class="router-head">
      <div>
        <h1>Router — élő YAML</h1>
        <p class="muted">
          Ez az egyetlen router-config: megoldók, témakörök és szabályok. Mentéskor a
          teljes fájl validálódik, az előző verzió backupba kerül, és a következő
          javaslat már ezt használja.
        </p>
      </div>
      {#if routerData}
        <p class="muted small router-summary">
          <strong>{routerData.counts.solvers}</strong> megoldó ·
          <strong>{routerData.counts.topics}</strong> témakör ·
          <strong>{routerData.counts.rules}</strong> szabály
        </p>
      {/if}
    </div>

    {#if error}
      <div class="error" style="margin-top:.75rem">{error}</div>
    {/if}

    {#if routerData}
      <CodeEditor value={sourceText} onchange={(text) => (sourceText = text)} />

      {#if editorError}
        <div class="error" style="margin-top:.5rem">{editorError}</div>
      {/if}
      {#if editorNotice}
        <div class="success" style="margin-top:.5rem">{editorNotice}</div>
      {/if}

      <div class="row" style="margin-top:.6rem">
        <button
          class="primary"
          type="button"
          onclick={saveEditing}
          disabled={saving || !editorDirty}
        >{saving ? 'Mentés…' : 'Mentés + validálás'}</button>
        <button type="button" onclick={revertEditing} disabled={saving || !editorDirty}>
          Visszaállítás
        </button>
        <button type="button" onclick={downloadEditing} disabled={saving}>Letöltés</button>
        {#if editorDirty}
          <span class="muted small">Mentetlen módosítás — mentésig a régi router él.</span>
        {/if}
      </div>
    {:else}
      <div class="empty">
        <h2>Router betöltése…</h2>
        <p>Ha nem jelenik meg, nézd meg a fenti hibát.</p>
      </div>
    {/if}
  </section>
{/if}
