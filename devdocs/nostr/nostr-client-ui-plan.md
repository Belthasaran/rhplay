# Nostr Client UI Enhancements

## 1. Goals
- Surface Nostr activity in a way that complements existing Online dialogs.
- Provide intuitive discovery of external reviews, declarations, and posts without overwhelming users.
- Offer controls for managing the background service, relay health, follow lists, and Online/Offline mode selection.
- Ensure the new UI scales to future features: forums, chat, DMs, verification workflows.

## 2. Primary UI Blocks

### 2.1 Online Dialog Extensions
- **Mode selector panel** at the top: toggle between `Offline` and `Online` modes with explanatory text. First activation of Online opens a confirmation modal describing data usage and features.
- **New `Nostr` tab** alongside `Profile & Keys` and `Trust Declarations`.
- Sections:
  - `Connection Status`: list current relays, connection/latency state, last sync times.
  - `Outgoing Queue`: table of pending/published events (profiles, keypairs, ratings) with retry actions.
  - `Follow Sources`: read-only summary broken down by admin/master/user profiles, trust declarations, manual follows.
  - `Service Controls`: start/stop background service, toggle auto-start, view log snippet.

### 2.2 Global Activity Feed
- New sidebar drawer (accessible from main toolbar) showing:
  - Tabs for `All Activity`, `Trusted Admins`, `My Network`, `Mentions`.
  - Filter by event type (profiles, ratings, declarations, forums, chats).
  - Infinite scrolling backed by `nostr_store_in`.
- Each card uses consistent layout: avatar, canonical name, summary, timestamp, actions (view details, trust, hide, report).

### 2.3 Game-Centric View
- On game detail screen, add `Community Activity` tab with sub-tabs:
  - `Reviews`: aggregated ratings + comments pulled from incoming Nostr events.
  - `Discussions`: forum/chat posts tagged with the game ID.
  - `Trust Signals`: declarations affecting this game or related moderators.
- Provide filters (language, recency, trust level) and ability to pin authoritative posts.

### 2.4 Profile Activity Overlay
- When viewing another user's profile, show their published ratings, declarations, and posts (with trust indicators).
- Button to follow/unfollow (adds manual follow entry) and to open DM (future feature).

### 2.5 Background Service Indicator
- System tray icon + in-app status chip showing `Offline`, `Synced`, `Syncing`, `Paused`, `Error`.
- Clicking opens condensed dashboard with relays, last processed event, queue depth, current mode, and toggle controls (including option to drop to Offline Mode).

## 3. Interaction Flows
- **Publishing flow**: After publishing (profile/rating/keys), confirmation toast with link to Outgoing Queue panel.
- **Review consumption**: Users can like, bookmark, or share reviews. Bookmarks stored locally; share produces Nostr event.
- **Trust declaration insight**: Inline highlighting when a post comes from a key covered by a trust declaration. Provide quick link to declaration detail.
- **Relay management**: Settings dialog for adding/removing relays, prioritizing relays, and enabling Tor/proxy.
- **Manual follow management**: UI to add Nostr public keys, view source of follow (manual vs derived), disable individual entries.
- **Notification system**: Desktop notifications (if enabled) for mentions, direct messages, or high-priority admin announcements.
- **Mode switching**: Central toggle accessible from Online dialog and tray indicator; entering Online prompting consent dialog, returning to Offline showing summary of pending actions.

## 4. Data Presentation Guidelines
- Use badges to denote trust level (`Master Admin`, `Operating Admin`, `Authorized Admin`, `Community`).
- Show event kind and status (draft, finalized, published) when relevant.
- Provide relative timestamps with tooltip for absolute time.
- For long content (forum posts), provide expandable preview with modal for full view.

## 5. Accessibility & Localization
- Ensure keyboard navigation across new components.
- Support text scaling and high-contrast themes.
- Plan for localization of labels, tooltips, and dynamic content (dates, numbers).

## 6. Future Hooks
- Placeholder tabs for `Forums`, `Chats`, `Direct Messages` with explanatory text until features ship.
- DM composer modal leveraging planned encryption workflow (NIP-04/44) once available.
- Verification workflows for linking external identities (GitHub, web domains) using Nostr events.

## 7. Implementation Phases
1. **Foundational UI**: Online dialog `Nostr` tab, background service indicator, outgoing queue view.
2. **Activity Feeds**: Global feed drawer + game-specific community tab.
3. **Follow & Relay Controls**: Manual follow management, relay settings, notifications.
4. **Advanced Interactions**: Profile overlays, DM scaffolding, verification hooks.

