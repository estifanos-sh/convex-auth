<script lang="ts">
	import { onMount } from 'svelte';

	interface Heading {
		id: string;
		text: string;
		level: number;
	}

	let headings = $state<Heading[]>([]);
	let activeId = $state('');

	onMount(() => {
		const content = document.querySelector('.doc-content');
		if (!content) return;

		const els = content.querySelectorAll('h2, h3');
		headings = Array.from(els).map((el) => ({
			id: el.id,
			text: el.textContent ?? '',
			level: parseInt(el.tagName[1]),
		}));

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						activeId = entry.target.id;
					}
				}
			},
			{ rootMargin: '-80px 0px -70% 0px' },
		);

		for (const el of els) observer.observe(el);

		return () => observer.disconnect();
	});
</script>

{#if headings.length > 0}
	<aside class="toc">
		<nav>
			<p class="toc-label">On this page</p>
			<ul>
				{#each headings as heading (heading.id)}
					<li class={heading.level === 3 ? 'nested' : undefined}>
						<a
							href={`#${heading.id}`}
							class={activeId === heading.id ? 'active' : undefined}
							aria-current={activeId === heading.id ? 'location' : undefined}
						>
							{heading.text}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	</aside>
{/if}

<style>
	.toc {
		width: 12rem;
		flex-shrink: 0;
		position: sticky;
		top: 5.5rem;
		height: calc(100vh - 5.5rem);
		overflow-y: auto;
		scrollbar-width: none;
		padding: 0.75rem 0 2rem;
	}

	.toc::-webkit-scrollbar {
		display: none;
	}

	.toc-label {
		font-family: var(--font-label);
		font-size: 0.58rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.13em;
		color: var(--muted);
		padding: 0 0 0.75rem;
		margin: 0 0 0.5rem;
		border-bottom: 1px solid var(--line);
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li a {
		position: relative;
		display: block;
		padding: 0.28rem 0;
		color: var(--muted);
		font-size: 0.72rem;
		text-decoration: none;
		line-height: 1.45;
		transition: color 130ms ease;
	}

	li.nested a {
		padding-left: 0.8rem;
	}

	li a:hover {
		color: var(--ink-2);
	}

	li a.active {
		color: var(--accent);
	}

	li a.active::before {
		content: '';
		position: absolute;
		top: 0.58rem;
		left: -0.75rem;
		width: 3px;
		height: 3px;
		background: var(--accent);
	}
</style>
