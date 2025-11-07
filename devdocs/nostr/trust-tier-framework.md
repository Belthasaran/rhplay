# Trust Tier Framework

## 1. Overview
This document describes the verification and trust framework for user profiles, ratings, and delegated responsibilities on the platform. It aligns trust levels with the Nostr trust declaration system so that we can consistently evaluate user authority, empower staff, and mitigate abuse risks.

## 2. Trust Level Scale (-2 to 30)
- **Level -2**: Permanently banned (severe infractions).
- **Level -1**: Temporarily banned or muted users (cooldown period).
- **Level 0**: De-verified/censured users. Moderators/admins may impose a `trust_limit` lowering a user to this level (or higher) within their scope.
- **Level 1**: Brand new / unverified users.
- **Level 2**: Peer-certified level 1 (endorsed by a verified user; following counts as minimal endorsement).
- **Level 3**: Peer-certified level 2 (endorsed by a level ≥3 user or via threshold endorsements).
- **Level 4**: Peer-certified level 3 (endorsed by high-level peers meeting trust thresholds).
- **Level 5**: Fully peer-verified; may be certified by delegated authorities.
- **Levels 6-10**: Verified by authorized admin. Authorized admins may certify users up to one level below their own trust level.
- **Level 7**: Trusted member.
- **Level 8**: Highly trusted member (ratings/reviews flagged as high credibility).
- **Level 11**: Authorized admin (trusted public key automatically at level ≥11).
- **Levels 12-19**: Verification by operating admin within their scope.
- **Level 20**: Operating admin (full authority for a specific scope; automatic level 20).
- **Levels 21-29**: Verified by master admin with maximum authority.
- **Level 30**: Master admin (top-level authority; automatic level 30).

## 3. Trust Tiers
Derived categories simplify policy decisions:
- **Restricted**: trust level ≤ 0 (limited permissions, ratings excluded from public aggregate).
- **Unverified**: trust level between 1–4 (baseline features, subject to rate limits).
- **Verified**: trust level 5–7 (eligible for advanced features, ratings counted with normal weight).
- **Trusted**: trust level ≥ 8 (priority for ratings aggregation, second-factor moderation privileges).

## 4. Trust Assignments & Limits
- Stored in `trust_assignments` table.
- Each assignment includes `assigned_trust_level`, optional `trust_limit`, scope, issuer, and expiration.
- Multiple assignments combine: highest assigned level above zero prevails unless a `trust_limit` reduces it; penalties (negative or zero assignments) override positives when within scope.
- Inherited authority is limited by issuer scope in the trust declaration system.
- Section scopes may form hierarchies (e.g., top-level “Kaizo” tag with nested forums/channels). Operating admins can adopt or attach related sections via trusted metadata updates; delegates inherit permissions across the subtree unless explicitly excluded.

## 5. Integration with Trust Declarations
- Trust declarations issued by Master/Operating/Admin roles define scopes (global, section, forum). They provide the legal basis for assigning verification levels, moderators, or revoking privileges.
- The runtime should evaluate declarations for the user’s public key alongside manual trust assignments.
- Authorized admins issue statements to promote/demote delegates; Master admins can supersede any lower-level certifications.
- A backend permission helper will map requested actions/scopes to declaration scopes (with hierarchy awareness) to ensure all moderation/admin actions are validated before execution.
- `ModerationManager` persists the resulting directives in `moderation.db`, providing an auditable trail for downstream clients to enforce legitimate actions.

## 6. Delegated Roles
### 6.1 Moderators / Section Managers
- Typically trusted (level ≥8) before receiving moderation scope.
- Delegations specify scope (forum section, tag, geographic region) and permitted actions (muting, flagging, issuing temporary trust limits).
- Actions must be logged and reviewable by higher-level admins.

### 6.2 Admin Delegates
- Authorized admins (level 11+) can delegate responsibilities to lower-level users (e.g., forum managers, subsection moderators) by issuing declarations and trust assignments.
- Operating admins (level 20) oversee multiple sections and can create subordinate admins with limited scopes.
- Master admins (level 30) maintain global oversight and can revoke any delegation.

## 7. Abuse Mitigation & Oversight
- Audit trail: every trust assignment/declaration includes issuer, scope, reason, and expiry.
- Automated checks: prevent scope escalation beyond issuer’s authority.
- Rate limits/throttles remain in place for unverified users to reduce spam.
- Revocation workflows allow higher-level admins to quickly nullify subordinate certifications.
- Periodic review of `trust_assignments` ensures expired entries are purged.

## 8. Next Steps
- Implement trust-level evaluation in ingestion pipelines (ratings complete via `TrustManager`) and expose trust summaries to the UI.
- Connect trust declarations processing to runtime trust determination (map canonical scopes to assignments and auto-create trust records).
- Provide admin tooling to issue/revoke trust assignments and inspect user trust history (IPC endpoints available; UI pending).
- Develop monitoring dashboards and alerts for unusual delegation patterns or abuse signals.
- Expand CLI tooling (`enode.sh cli/trust-inspector.js`) and corresponding admin UI panels for deeper visibility into trust assignments, declarations, and scopes.
