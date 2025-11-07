# Moderator Dashboard Prototype (November 2025)

## Overview
The Moderator Dashboard is now exposed in the Online dialog as a third tab alongside **Profile & Keys** and **Trust Declarations**. It gives privileged operators a consolidated view of:

- Current trust level/tier resolved for the active profile key.
- Aggregated scope/permission summary derived from signed trust declarations.
- Quick actions for common moderation directives (block, mute, freeze, warn).
- A history table populated from `moderation.db` (`moderation_actions`, `moderation_logs`) with the ability to revoke active entries.

All actions are routed through the main process via:

- `moderation:block-target`
- `moderation:revoke-action`
- `moderation:list-actions`

Those IPC handlers call into `ModerationManager`, which enforces trust thresholds by consulting `TrustManager` before persisting anything to the moderation database.

## Access Requirements
Only actors whose resolved trust level is **≥ 7** (the current `minimumModerationLevel`) or who possess specific moderation permissions in their trust declarations will see the dashboard content.

`ModerationManager` computes the acting public key’s level by calling `TrustManager.getTrustLevel`. The dashboard therefore needs the active profile’s **primary Nostr key** to be recognised as having sufficient trust.

## How Trust Is Determined
`TrustManager` combines the following:

1. **Admin key classification** – master/operating/authorized admin keypairs stored in `admin_keypairs` contribute fixed baseline levels (30/20/11).
2. **Signed trust declarations** – declarations with `usage_types` such as `moderation` and permissions like `can_moderate`, `can_delegate_moderators`, `can_update_metadata` raise or limit trust levels inside the scopes they cover.
3. **Manual trust assignments** – entries in `ratings.trust_assignments` can raise/lower trust or impose limits.

If no declaration references the active profile’s primary key, the dashboard will stay locked even if the operator controls higher-tier admin keys.

## Granting Yourself Moderator Access
The typical workflow for a staff member who controls a master admin (or other admin) secret key is:

1. **Ensure the user profile is set up**
   - The profile’s primary keypair must be the operator’s Nostr user key (the key that will act in the UI).
   - Profile Guard must be unlocked so the private key can be used when signing declarations.

2. **Have an admin signing key available**
   - For master/operating/admin delegation, the operator needs a master admin keypair (or an existing operating/authorized admin keypair) with the private component loaded.
   - This key may already live in `admin_keypairs` or can be imported via the Admin Keypairs panel.

3. **Issue a trust declaration that grants moderation**
   - Open **Online → Trust Declarations → Create New Declaration**.
   - Choose the admin keypair as the issuer.
   - For subject, select the profile’s primary Nostr key.
   - In the form (New Delegation template):
     - Pick a trust level of at least `authorized-admin` (11) or higher.
     - Include `usage_types` containing `moderation`.
     - Ensure `permissions.can_moderate` (and any other desired permissions) are enabled.
     - Define the scopes (`global`, `section`, etc.) that the moderation powers should cover.
   - Save draft, then **Finalize and Reload**.

4. **Sign the declaration**
   - On the Status tab, click **Issuer Sign**.
   - Enter the admin key’s passphrase if required; the declaration will move to `Signed`.

5. **Publish (optional at this stage)**
   - Publishing to Nostr is not required for local enforcement but is recommended for network propagation.
   - Use **Publish Declaration** when ready.

6. **Reload the Online dialog**
   - Close and reopen the Online panel (or switch tabs) so `ModeratorDashboard` fetches the updated trust snapshot via `trust:permissions:get`.
   - The Moderation tab should now render the dashboard instead of the “no permission” message.

### Alternative: Manual Trust Assignment
For quick local testing, an operator can create a manual trust assignment using the CLI:

```bash
./enode.sh cli/trust-inspector.js permissions <npub OR hex>
```

- Use the CLI to inspect current levels.
- A future helper will provide `trust:assignments:create`; once exposed in the UI, operators will be able to assign level ≥7 to their user key directly from the client—until then, this requires executing database updates manually.

## User Experience Notes
- Actions are optimistic: when the IPC call succeeds, the dashboard immediately refreshes the list via `moderation:list-actions`.
- Revoke buttons are only shown for active entries.
- All moderation directives are persisted with issuer pubkey, trust level, scope information, and (where applicable) signed event metadata. Future versions will additionally enforce scope matching on the frontend before enabling specific buttons.

## Next Steps
- Expand the dashboard to surface moderation blocks and freezes with richer metadata (`content_json`).
- Add filters (target search, scope filter) and export options.
- Integrate a local preview of trust declarations affecting the profile to explain why certain scopes/actions are available or restricted.
- Provide an admin UI for authoring manual trust assignments without dropping to CLI.

