export interface SidebarItem {
  title: string;
  slug: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export const sidebar: SidebarGroup[] = [
  {
    label: "Start",
    items: [
      { title: "Installation", slug: "/getting-started/installation" },
      { title: "Providers", slug: "/getting-started/providers" },
      { title: "Environment", slug: "/getting-started/environment" },
    ],
  },
  {
    label: "Build",
    items: [
      { title: "React", slug: "/client/react" },
      { title: "Svelte", slug: "/client/svelte" },
      { title: "Authorization", slug: "/guides/authorization" },
      { title: "Multi-Access", slug: "/guides/multi-access" },
      { title: "Context Enrichment", slug: "/integration/context" },
      { title: "Fluent Convex", slug: "/integration/fluent-convex" },
      { title: "Device Flow", slug: "/guides/device-flow" },
      { title: "MCP Server", slug: "/guides/mcp-server" },
      { title: "Native Apps", slug: "/guides/native-apps" },
      { title: "Production", slug: "/guides/production" },
    ],
  },
  {
    label: "Enterprise",
    items: [
      { title: "Overview", slug: "/connection/overview" },
      { title: "Client RPC", slug: "/connection/rpc" },
      { title: "Connections", slug: "/connection/connection" },
      { title: "Policies", slug: "/connection/policy" },
      { title: "OIDC", slug: "/connection/oidc" },
      { title: "SAML", slug: "/connection/saml" },
      { title: "SCIM", slug: "/connection/scim" },
      { title: "Audit Log", slug: "/connection/audit" },
      { title: "Webhooks", slug: "/connection/webhook" },
    ],
  },
  {
    label: "Server Rendering",
    items: [
      { title: "Overview", slug: "/ssr/overview" },
      { title: "SvelteKit", slug: "/ssr/sveltekit" },
      { title: "TanStack Start", slug: "/ssr/tanstack" },
      { title: "Next.js", slug: "/ssr/nextjs" },
    ],
  },
  {
    label: "Reference",
    items: [
      { title: "auth.user", slug: "/api/user" },
      { title: "auth.session", slug: "/api/session" },
      { title: "auth.account", slug: "/api/account" },
      { title: "auth.group", slug: "/api/group" },
      { title: "auth.member", slug: "/api/member" },
      { title: "auth.invite", slug: "/api/invite" },
      { title: "auth.key", slug: "/api/key" },
      { title: "Configuration", slug: "/reference/config" },
      { title: "Typed Returns (auth.v)", slug: "/reference/typed-returns" },
      { title: "Error Codes", slug: "/reference/errors" },
      { title: "CLI Reference", slug: "/reference/cli" },
      { title: "Data Migrations", slug: "/reference/migrations" },
      { title: "Architecture", slug: "/reference/architecture" },
      { title: ".well-known", slug: "/reference/well-known" },
    ],
  },
];
