<script lang="ts">
	import { setContext, type Snippet } from 'svelte';

	let { syncKey, children }: { syncKey?: string; children: Snippet } = $props();
	let activeTab = $state(0);

	const tabs: string[] = $state([]);

	function registerTab(label: string): number {
		const idx = tabs.length;
		tabs.push(label);
		return idx;
	}

	setContext('tabs', {
		get activeTab() {
			return activeTab;
		},
		registerTab,
		setActive: (idx: number) => {
			activeTab = idx;
		},
	});
</script>

<div class="tabs">
	<div class="tab-bar" role="tablist">
		{#each tabs as label, i (label)}
			<button
				role="tab"
				aria-selected={activeTab === i}
				class={activeTab === i ? 'active' : undefined}
				onclick={() => {
					activeTab = i;
				}}
			>
				{label}
			</button>
		{/each}
	</div>
	<div class="tab-content">
		{@render children()}
	</div>
</div>

<style>
	.tabs {
		margin: 1.25rem 0;
	}

	.tab-bar {
		display: flex;
		gap: 0;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--line);
	}

	button {
		padding: 0.5rem 0.7rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		margin-bottom: -1px;
		transition:
			color 0.15s ease,
			border-color 0.15s ease;
	}

	button:hover {
		color: var(--ink);
	}

	button.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
</style>
