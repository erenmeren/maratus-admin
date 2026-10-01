# Phase 2 — Team Member Invites Design

_Last updated: 2026-06-02_

## Context

Maratus uses Better Auth's **organization plugin** (`organization = tenant`).
The `member` and `invitation` tables already exist, the client has
`organizationClient()`, and the plugin ships invite/accept APIs — but there is
**no member-management UI** today (only the org owner, created at signup, exists).
This feature wires the plugin's built-in flow into a Members page + invite/accept
UX, and finally records the member-event audit entries stubbed in Billing Spec 2.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| First Phase 2 feature | **Team member invites** |
| Permissions | **Owner + admins manage** (invite/role/remove); **members read-only** (can view the team list). Better Auth's default org model. |
| Invitee onboarding | **Invite-token signup path** — invite link → `/signup?invite=<id>`; new users create an account that joins the inviting org (no new org created) |
| Mutation path | **Server actions calling `auth.api.*`** (not client-direct) — keeps auth + audit + revalidation consistent |
| Invite roles | **admin / member only** (owner cannot be granted via invite); default **member** |
| Email-verification | Invitees are marked `emailVerified: true` on invite-signup (the invitation proves inbox ownership) — no extra verification round-trip |

## Goals

1. Owners/admins can invite a teammate by email + role (admin or member), see
   pending invites, change a member's role, and remove a member.
2. Members can view the team list (read-only).
3. An invited person — new or existing Maratus user — can accept and join the
   **inviting** org via `/signup?invite=<id>` (never creating a new org).
4. Invite emails are sent via Resend (graceful console-log no-op without a key).
5. Member events are recorded to the audit log.

## Non-Goals

- Ownership transfer (owner stays owner; out of scope).
- Seat limits / per-seat billing (billing is metered-per-receipt; members unlimited).
- Custom roles/permissions beyond Better Auth's owner/admin/member.
- Bulk invite / CSV.

---

## Architecture

### 1. Invite email (`lib/auth.ts`)

Configure the org plugin's `sendInvitationEmail`:

```ts
organization({
  async sendInvitationEmail(data) {
    const url = `${env.BETTER_AUTH_URL}/signup?invite=${data.id}`;
    await sendEmail(
      data.email,
      `You're invited to ${data.organization.name} on Maratus`,
      `<p>${data.inviter.user.name} invited you to join <b>${data.organization.name}</b> on Maratus.</p>` +
        `<p><a href="${url}">Accept the invitation</a></p>`,
    );
  },
}),
```

(`data` shape is the org plugin's invitation payload: `id`, `email`,
`organization`, `inviter`, `role`. Verify exact field names against the installed
better-auth version during implementation.)

### 2. Server actions (`lib/actions/members.ts`)

Each calls the Better Auth **server API** with the request headers for auth
context, then `recordAudit`. The org plugin enforces owner/admin permission
itself (we don't re-implement authz), and rejects assigning `owner` via invite.

- `inviteMember(email, role: "admin" | "member")` → `auth.api.createInvitation`
  → audit `member.invited` (metadata `{ email, role }`).
- `cancelInvitation(invitationId)` → `auth.api.cancelInvitation` → audit `invitation.canceled`.
- `removeMember(memberIdOrUserId)` → `auth.api.removeMember` → audit `member.removed`.
- `updateMemberRole(memberId, role: "admin" | "member")` → `auth.api.updateMemberRole`
  → audit `member.role_changed` (metadata `{ to: role }`).

All actions: `requireTenant()` for the session/org, pass `headers: await headers()`
to `auth.api`, `revalidatePath("/tenant/members")`, return `{ ok }` / `{ ok:false, error }`.

### 3. Members page (`app/(tenant)/tenant/members/page.tsx` + nav)

- Data layer (`lib/data.ts`): `getOrgMembers(orgId)` — `member ⋈ user`
  (id, name, email, role, joinedAt); `getOrgInvitations(orgId)` — pending rows
  (id, email, role, expiresAt).
- Server component: `requireTenant()`; `canManage = membershipRole ∈ {owner, admin}`.
- Renders **Members** (name, email, role) and **Pending invitations** (email, role).
  When `canManage`: an invite form (email + role select: admin/member, default
  member) + per-row controls (change role, remove; cancel invite). When not:
  read-only lists.
- A small client component (`components/members/*`) holds the invite form + row
  actions (calls the server actions). Owners cannot be removed/role-changed in the UI.
- `lib/nav.ts`: add `{ label: "Members", href: "/tenant/members", icon: Users }` to `TENANT_NAV`.

### 4. Accept flow (`/signup?invite=<id>`)

The signup page (`app/(auth)/signup/page.tsx`) branches when `invite` is present:

1. Load the invitation server-side (email, org name, status). Invalid/expired/used → error message.
2. **Signed in as the invited email** → show "Accept invitation to *Org*"; a server
   action calls `auth.api.acceptInvitation` → redirect `/tenant`.
3. **Signed in as a different user** → "You're signed in as X. Sign out to accept this invite for Y."
4. **Not signed in** → signup form with **email locked** to the invitation. On submit, a
   server action `acceptInviteSignup({ invitationId, name, password })`:
   - `auth.api.signUpEmail({ name, email, password })` (creates the user, no org).
   - Set the new user's `emailVerified = true` (invite proves inbox ownership).
   - Establish a session (`auth.api.signInEmail`) and `auth.api.acceptInvitation`
     with that session → the user joins the inviting org.
   - Redirect `/tenant`.

The default (no `invite` param) signup path — create company + owner — is
unchanged.

> Implementation note: the exact better-auth server API call names/shapes
> (`createInvitation` vs `inviteMember`, `acceptInvitation` body, how to set the
> session after sign-up) must be verified against the installed version
> (better-auth 1.6.x) during the plan, using context7 / node_modules types.

### 5. Audit

Add `AUDIT` constants and record from the server actions:
`member.invited`, `member.added` (on accept), `member.removed`,
`member.role_changed`, `invitation.canceled`. The accept actions record
`member.added` (actor = the accepting user).

### 6. Data model

**No schema changes** — `member` and `invitation` tables already exist. Only new
audit action strings (constants in `lib/audit.ts`).

---

## Error handling

- Invite to an email that's already a member → surface the plugin's error in the form.
- Expired/used/invalid invitation on the accept page → friendly message, no crash.
- `auth.api` errors in server actions → returned as `{ ok:false, error }` and shown inline.
- `recordAudit` is best-effort (never breaks the action).
- Resend not configured → invite link logged to the server console (dev-usable).

## Testing

- **Pure unit (TDD):** `canManageMembers(role)` → true for `owner`/`admin`, false
  for `member`; `inviteRoleIsValid(role)` → true only for `admin`/`member`.
- **tsc + build** gate the `auth.api` integration.
- **Manual:** owner invites a member → invite email/link → open `/signup?invite=` in a
  fresh session → create account → lands in the inviting org as a member; audit
  rows present; role change + remove work; a `member`-role user sees read-only lists.

## File structure

| File | Responsibility | New? |
|---|---|---|
| `lib/auth.ts` | `sendInvitationEmail` on the org plugin | Modify |
| `lib/actions/members.ts` | invite/cancel/remove/role + accept server actions | Create |
| `lib/members.ts` | pure helpers `canManageMembers`, `inviteRoleIsValid` | Create |
| `lib/members.test.ts` | tests for the pure helpers | Create |
| `lib/audit.ts` | + member action constants | Modify |
| `lib/data.ts` | `getOrgMembers`, `getOrgInvitations` | Modify |
| `app/(tenant)/tenant/members/page.tsx` | Members page | Create |
| `components/members/members-manager.tsx` | client invite form + row actions | Create |
| `app/(auth)/signup/page.tsx` | invite-token branch (accept / locked signup) | Modify |
| `lib/nav.ts` | + Members in `TENANT_NAV` | Modify |

## Sequencing

1. Pure helpers (`canManageMembers`, `inviteRoleIsValid`) + tests.
2. `sendInvitationEmail` wiring + audit constants.
3. Member server actions (`auth.api` + audit).
4. Data fns + Members page + client manager + nav.
5. Accept flow on `/signup?invite=` (incl. invite-signup server action + emailVerified bypass).
6. Manual end-to-end verification.
