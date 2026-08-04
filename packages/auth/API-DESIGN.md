# Public API consistency design

Status: implemented on this branch and migrated in `../ledger`.

## Principles

- Common reads stay indexed and predictable.
- Traversal, projection, and protocol operations use explicit names rather
  than boolean modes.
- Current-user management derives ownership from `ctx.auth`.
- Provider identity is accepted only from a completed provider ceremony.
- Raw credential material remains inside the component or provider callback
  capability.

## Final shapes

| Concern            | Public shape                                            | Internal capability                               |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------- |
| Membership         | `get`, batch `get`, `resolve`, `assert`, plain `list`   | Component direct lookup and hierarchy traversal   |
| Active group       | `get`, `update(ctx, { groupId, userId? })`, `reset`     | Transactional indexed component functions         |
| User deletion      | `remove(ctx, { id })` always cleans auth-owned children | No partial public delete                          |
| Invite token       | `token.accept(ctx, { token })` derives current user     | Component accepts the resolved user ID            |
| Accounts           | Current-user `list` and `remove` summaries              | Provider callback `create/get/update/unlink`      |
| Factors            | Current-user `list/update/remove` summaries             | Raw passkey/TOTP component records                |
| Custom credentials | `authorize` may return `{ provision }`                  | Runtime provisions/retrieves the provider account |
| HTTP composition   | `http()`, `request.mount(http)`, `request.routes()`     | Route table construction remains private          |
| OAuth              | `authorize` and client administration                   | Codes, refresh exchange, and secret verification  |
| Extensions         | `provider.signIn`, `event.emit`                         | Same audited runtime paths                        |

## Consumer proof

Ledger's invite provider now returns a verified provisioning result instead of
calling raw account helpers. Its deployment-status gate wraps descriptors from
`request.routes()`, and every active-group and invite call uses the canonical
object/current-user shapes.

No compatibility aliases are retained: this branch is intentionally the
long-term API cut before a stable release.
