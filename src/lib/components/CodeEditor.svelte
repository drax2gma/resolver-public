<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorView } from '@codemirror/view';
  import type { Diagnostic } from '@codemirror/lint';

  let {
    value,
    onchange
  }: {
    value: string;
    onchange: (value: string) => void;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;

  function offsetFor(
    doc: { lines: number; line(n: number): { from: number } },
    line: number,
    col: number
  ): number {
    const safeLine = Math.min(Math.max(1, line), doc.lines);
    return doc.line(safeLine).from + Math.max(0, col - 1);
  }

  onMount(() => {
    let disposed = false;

    void (async () => {
      const [{ basicSetup }, { EditorView: View }, { yaml }, { linter, lintGutter }, { oneDark }] =
        await Promise.all([
          import('codemirror'),
          import('@codemirror/view'),
          import('@codemirror/lang-yaml'),
          import('@codemirror/lint'),
          import('@codemirror/theme-one-dark')
        ]);
      if (disposed || !host) return;

      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      const lintSource = linter(
        async (editor) => {
          const text = editor.state.doc.toString();
          if (!text.trim()) return [];

          const { parseDocument } = await import('yaml');
          const doc = parseDocument(text);
          const diagnostics: Diagnostic[] = [];
          const push = (
            items: Array<{ message: string; linePos?: Array<{ line: number; col: number }> }>,
            severity: 'error' | 'warning'
          ) => {
            for (const item of items) {
              const pos = item.linePos?.[0];
              const from = Math.min(
                pos ? offsetFor(editor.state.doc, pos.line, pos.col) : 0,
                editor.state.doc.length
              );
              diagnostics.push({
                from,
                to: Math.min(from + 1, editor.state.doc.length),
                severity,
                message: item.message
              });
            }
          };
          push(doc.errors, 'error');
          push(doc.warnings, 'warning');
          return diagnostics;
        },
        { delay: 250 }
      );

      view = new View({
        doc: value,
        parent: host,
        extensions: [
          basicSetup,
          yaml(),
          View.lineWrapping,
          lintGutter(),
          lintSource,
          View.updateListener.of((update) => {
            if (update.docChanged) onchange(update.state.doc.toString());
          }),
          View.theme({
            '&': { height: '62vh', fontSize: '13px' },
            '.cm-scroller': {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
            }
          }),
          ...(dark ? [oneDark] : [])
        ]
      });
    })();

    return () => {
      disposed = true;
      view?.destroy();
    };
  });
</script>

<div class="code-editor" bind:this={host} aria-label="Router YAML szerkesztője"></div>
