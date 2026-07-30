<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { slide, fade } from 'svelte/transition';
	import { sidebar } from '$lib/config/sidebar';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let query = $state('');
	let results = $state<Array<{ url: string; title: string; excerpt: string; section: string }>>([]);
	let activeIndex = $state(0);
	let pagefind: any = $state(null);

	// Build a url -> section label map from sidebar config.
	const sectionMap = new SvelteMap<string, string>();
	for (const group of sidebar) {
		for (const item of group.items) {
			sectionMap.set(item.slug, group.label);
			sectionMap.set(item.slug + '/', group.label);
		}
	}

	function getSectionLabel(url: string): string {
		const path = url.split(/[?#]/)[0];
		const hasBase = base && (path === base || path.startsWith(`${base}/`));
		const withoutBase = hasBase ? path.slice(base.length) : path;
		const clean = withoutBase.replace(/\/+$/, '');
		return sectionMap.get(clean) ?? '';
	}

	function appUrl(url: string): string {
		const hasBase = base && (url === base || url.startsWith(`${base}/`));
		if (/^https?:\/\//.test(url) || hasBase) return url;
		return `${base}${url.startsWith('/') ? url : `/${url}`}`;
	}

	function excerptText(excerpt: string): string {
		return excerpt.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
	}

	onMount(async () => {
		try {
			const pagefindUrl = `${base}/pagefind/pagefind.js`;
			const resp = await fetch(pagefindUrl);
			if (!resp.ok) return;
			pagefind = await new Function('path', 'return import(path)')(pagefindUrl);
			await pagefind.init();
		} catch (e) {
			console.warn('Pagefind not available:', e);
		}
	});

	async function search(q: string) {
		if (!pagefind || !q.trim()) {
			results = [];
			activeIndex = 0;
			return;
		}

		const response = await pagefind.search(q);
		const items = await Promise.all(
			response.results.slice(0, 6).map(async (r: any) => {
			const data = await r.data();
			return {
				url: data.url,
				title: data.meta?.title || data.url,
				excerpt: excerptText(data.excerpt),
				section: getSectionLabel(data.url)
			};
		})
		);
		results = items;
		activeIndex = 0;
	}

	function resetSearchState() {
		query = '';
		results = [];
		activeIndex = 0;
	}

	function closeDialog() {
		open = false;
		resetSearchState();
	}

	function autofocusWhenOpen() {
		return (node: HTMLInputElement) => {
			requestAnimationFrame(() => node.focus());
		};
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = Math.min(activeIndex + 1, results.length - 1);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			return;
		}
		if (e.key === 'Enter' && results.length > 0) {
			e.preventDefault();
			selectResult(results[activeIndex].url);
		}
	}

	function selectResult(url: string) {
		closeDialog();
		goto(appUrl(url));
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			closeDialog();
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
	<div class="dialog-layer">
		<button
			class="scrim"
			transition:fade={{ duration: 100 }}
			onclick={closeDialog}
			aria-label="Close search"
		></button>
		<dialog
			open
			class="panel"
			transition:slide={{ duration: 150 }}
			onkeydown={handleKeydown}
			aria-modal="true"
			aria-labelledby="search-title"
		>
			<h2 id="search-title" class="sr-only">Search documentation</h2>
			<div class="panel-inner">
				<div class="input-row">
					<svg
						class="search-icon"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path d="M21.71 20.29 18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a.999.999 0 0 0 1.42 0 1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
					</svg>
					<input
						bind:value={query}
						{@attach open && autofocusWhenOpen()}
						oninput={() => search(query)}
						placeholder="Search documentation..."
						aria-label="Search documentation"
						type="text"
						spellcheck="false"
					/>
					<kbd class="esc-hint">ESC</kbd>
				</div>

				{#if results.length > 0}
					<ul class="results" aria-label="Search results">
						{#each results as result, i (result.url)}
							<li>
								<button
									class={['result-row', i === activeIndex && 'active']}
									onclick={() => selectResult(result.url)}
									onmouseenter={() => (activeIndex = i)}
								>
									{#if result.section}
										<span class="result-section">{result.section}</span>
									{/if}
									<span class="result-title">{result.title}</span>
									<span class="result-excerpt">{result.excerpt}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if query && pagefind}
					<p class="no-results" aria-live="polite">No results for “{query}”</p>
				{/if}
			</div>
		</dialog>
	</div>
{/if}

<style>
	.dialog-layer {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: clamp(4.75rem, 12vh, 8rem) 1rem 1rem;
	}

	.scrim {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: rgba(3, 4, 3, 0.78);
		backdrop-filter: blur(4px);
		cursor: default;
	}

	.panel {
		position: relative;
		inset: auto;
		width: min(100%, 39rem);
		max-height: calc(100dvh - 8rem);
		height: fit-content;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink-2);
		box-shadow:
			0 1px 0 rgba(231, 226, 214, 0.06) inset,
			0 2rem 6rem rgba(0, 0, 0, 0.42);
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.panel-inner {
		padding: 0 1.1rem;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 3.75rem;
	}

	.search-icon {
		flex-shrink: 0;
		color: var(--muted);
	}

	input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		font-family: var(--font-sans);
		font-size: 1rem;
		color: var(--ink);
	}

	input::placeholder {
		color: var(--faint);
	}

	.esc-hint {
		font-family: var(--font-mono);
		font-size: 0.56rem;
		letter-spacing: 0.05em;
		color: var(--faint);
		padding: 0.15rem 0.35rem;
		border: 1px solid var(--line);
	}

	.results {
		list-style: none;
		padding: 0;
		margin: 0;
		padding: 0.55rem 0;
		border-top: 1px solid var(--line);
	}

	.result-row {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.65rem 0.75rem;
		border: none;
		background: transparent;
		cursor: pointer;
		font-family: var(--font-sans);
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.result-row.active {
		background: var(--accent-soft);
	}

	.result-section {
		display: block;
		font-family: var(--font-mono);
		font-size: 0.55rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--muted);
		margin-bottom: 0.2rem;
	}

	.result-title {
		display: block;
		font-size: 0.88rem;
		font-weight: 500;
		color: var(--ink);
	}

	.result-row.active .result-title {
		color: var(--accent);
	}

	.result-excerpt {
		display: block;
		font-size: 0.72rem;
		color: var(--muted);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-top: 0.0625rem;
	}

	.no-results {
		margin: 0;
		padding: 1.25rem 0;
		border-top: 1px solid var(--line);
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.65rem;
		line-height: 1.6;
	}
</style>
