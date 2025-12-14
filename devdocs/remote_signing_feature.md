# Remote Signing Feature for Nostr Operations

## Overview

The remote signing feature allows admin keypairs and profile keypairs to use private keys stored in external hardware or mobile wallets instead of storing them encrypted within the application. This provides enhanced security by keeping private keys in dedicated, hardened devices while still allowing the application to perform signing operations for Nostr events, trust declarations, delegation, and moderation/metadata signing.

## Use Cases

1. **Admin Operations**: Sign trust declarations, admin delegations, and moderation actions using hardware wallets
2. **Profile Operations**: Sign game ratings and profile updates using mobile or hardware wallets
3. **Security Enhancement**: Keep sensitive private keys in dedicated security devices
4. **Multi-Device Access**: Use the same keypair across multiple devices via remote signing
5. **Compliance**: Meet organizational requirements for key management using approved hardware security modules

## Database Schema

### Admin Seeds (`admin_seeds` table)

**Purpose**: Store encrypted master seeds for admin keypairs, separate from user profile seeds.

- **`seed_id`** (VARCHAR(255), PRIMARY KEY): UUID identifier for this seed
- **`seed_name`** (TEXT): Human-readable name/description (e.g., "Primary Admin Seed", "Organization A Seed")
- **`encrypted_master_seed`** (TEXT, NOT NULL): Encrypted 256-bit (32-byte) master seed
  - Encrypted with Profile Guard key (same encryption method as `encrypted_private_key` in `admin_keypairs`)
  - Format: `IV:HEX_ENCRYPTED_SEED` (same format as other encrypted fields)
- **`seed_generated_at`** (TIMESTAMP): When seed was first generated
- **`created_at`** (TIMESTAMP): Record creation timestamp
- **`updated_at`** (TIMESTAMP): Auto-updated timestamp
- **`notes`** (TEXT): Optional notes about the seed (usage, organization, etc.)

**Key Design Points:**
- Allows multiple admin seeds (e.g., different seeds for different organizations or contexts)
- Admin seeds are independent of user profile seeds
- Encrypted using Profile Guard key (requires Profile Guard to be unlocked to access)
- Each seed can generate multiple admin keypairs using different derivation paths

### Admin Keypairs (`admin_keypairs` table)

The following columns support remote signing and seed-based generation:

- **`is_remote_signing`** (INTEGER, default 0): Flag indicating if keypair uses remote signing (1) or local storage (0)
- **`remote_wallet_type`** (TEXT): Type of remote wallet (e.g., 'hardware-ledger', 'hardware-trezor', 'mobile-nostr-wallet', 'ceramic', 'web3-wallet', 'custom')
- **`remote_wallet_id`** (TEXT): Wallet-specific identifier (device ID, derivation path, account identifier)
- **`remote_wallet_metadata`** (TEXT, JSON): Additional wallet-specific configuration (connection params, API endpoints, auth methods)
- **`seed_export_ready`** (INTEGER, default 0): Flag indicating if seed-based keypair can be exported to remote wallet
- **`is_seed_based`** (INTEGER, default 0): Flag indicating if keypair was generated from master seed
- **`derivation_path`** (TEXT): BIP32/BIP44 derivation path for seed-based keypairs (e.g., `m/44'/1237'/0'/0/0`)
- **`master_seed_id`** (TEXT): References `admin_seeds.seed_id` - identifies which admin seed was used to generate this keypair
  - NULL if keypair is not seed-based
  - Foreign key relationship (enforced at application level, not database level to allow flexibility)

### Profile Keypairs (`profile_keypairs` table)

Similar columns for profile keypairs:

- **`is_seed_based`** (INTEGER, default 0): Flag indicating if keypair was generated from master seed
- **`derivation_path`** (TEXT): BIP32/BIP44 derivation path for seed-based keypairs

### User Profiles (`user_profiles` table)

- **`encrypted_master_seed`** (TEXT): Encrypted 256-bit master seed (encrypted with Profile Guard key)
- **`seed_generated_at`** (TIMESTAMP): When the seed was first generated

## Recommended Wallets

### Hardware Wallets

#### 1. Ledger Devices (Nano S Plus, Nano X, Stax)

**Pros:**
- Industry-leading security with secure element
- Excellent BIP32/BIP44 support
- Multiple app ecosystems (Ledger Live, third-party apps)
- USB and Bluetooth connectivity options
- Wide community support

**Cons:**
- Requires Ledger device purchase (~$80-$300)
- Requires Ledger Live or compatible software
- May need custom Nostr app development

**Implementation Notes:**
- Use Ledger's JavaScript libraries for device communication
- BIP44 path: `m/44'/1237'/0'/0/0` for Nostr keys (coin type 1237 is unofficial but commonly used)
- Support both USB and Bluetooth transport for Nano X/Stax
- Implement device discovery and connection management
- Handle device PIN entry and approval prompts

#### 2. Trezor Devices (Trezor One, Trezor Model T)

**Pros:**
- Open-source hardware and firmware
- Good BIP32/BIP44 support
- Active development community
- Lower cost option (Trezor One ~$60)

**Cons:**
- Less polished user experience than Ledger
- Smaller app ecosystem
- May need custom Nostr app development

**Implementation Notes:**
- Use Trezor Connect library for device communication
- Similar BIP44 path support as Ledger
- USB-only (no Bluetooth) for most models
- Open-source approach may be preferred for security audits

### Mobile Wallets

#### 1. Nostr Mobile Wallets

**Examples:**
- **Damus** (iOS): Popular Nostr client with key management
- **Amethyst** (Android/iOS): Feature-rich Nostr client
- **Breez** (Android/iOS): Lightning-focused with Nostr support

**Pros:**
- Native Nostr key support
- Easy mobile-to-desktop pairing
- User-friendly interfaces
- Active development

**Cons:**
- Less secure than hardware wallets
- May not support BIP32 derivation
- Dependent on mobile app availability

**Implementation Notes:**
- Use NIP-46 (Nostr Remote Signing) protocol for communication
- Implement QR code pairing for initial connection
- Support WebSocket or HTTP relay-based communication
- Handle mobile app connection lifecycle

#### 2. Ceramic Network

**Pros:**
- Decentralized key management
- No hardware required
- Good for seed-based key derivation
- Web3-native approach

**Cons:**
- Requires network connectivity
- Less tested for Nostr use cases
- Additional infrastructure dependency

**Implementation Notes:**
- Use Ceramic DID for identity management
- Leverage Ceramic's key derivation system
- Implement Ceramic client SDK
- Handle network sync and conflicts

### Software/Web3 Wallets

#### 1. MetaMask / WalletConnect

**Pros:**
- Wide adoption and familiarity
- Good developer tooling
- Multi-chain support

**Cons:**
- Designed for Ethereum/Web3, not Nostr
- Key derivation may not match Nostr standards
- Additional conversion layer needed

**Implementation Notes:**
- Would require conversion between Ethereum keys and Nostr keys
- Use WalletConnect protocol for communication
- Less ideal than Nostr-native solutions

## Implementation Approach

### Phase 1: Seed-Based Keypair Generation

#### For User Profiles

1. **Master Seed Generation**
   - Generate cryptographically secure 256-bit (32-byte) random seed
   - Encrypt seed with Profile Guard key using AES-256-CBC
   - Store encrypted seed in `user_profiles.encrypted_master_seed`
   - Record generation timestamp in `seed_generated_at`

2. **Keypair Derivation**
   - Use BIP32/BIP44 hierarchical deterministic key derivation
   - Default path for Nostr keys: `m/44'/1237'/0'/0/index` (where index is sequential)
   - Derive private key from seed + derivation path
   - Generate public key from private key
   - Store `is_seed_based=1` and `derivation_path` in `profile_keypairs` record

3. **Migration for Existing Profiles**
   - Detect when profile is unlocked/accessed
   - Check if `encrypted_master_seed` is NULL or empty
   - If missing, generate new random seed and encrypt it
   - Do NOT replace existing Nostr keypairs during migration
   - Mark new keypairs as seed-based going forward

#### For Admin Keypairs

1. **Admin Master Seed Generation**
   - Generate cryptographically secure 256-bit (32-byte) random seed
   - Encrypt seed with Profile Guard key using AES-256-CBC
   - Store encrypted seed in `admin_seeds` table with a `seed_id` (UUID)
   - Optionally provide a `seed_name` for identification (e.g., "Primary Admin Seed")
   - Record generation timestamp in `seed_generated_at`

2. **Admin Keypair Derivation**
   - Select which admin seed to use (via `seed_id`)
   - Decrypt the seed using Profile Guard key
   - Use BIP32/BIP44 hierarchical deterministic key derivation
   - Default path for Nostr admin keys: `m/44'/1237'/0'/0/index` (or custom path)
   - Derive private key from seed + derivation path
   - Generate public key from private key
   - Store `is_seed_based=1`, `derivation_path`, and `master_seed_id` in `admin_keypairs` record

3. **Multiple Admin Seeds**
   - System supports multiple admin seeds in `admin_seeds` table
   - Each admin keypair references exactly one seed via `master_seed_id`
   - Allows organization/context separation (e.g., different seeds for different organizations)
   - When creating new admin keypair, user selects which seed to use (or creates new seed)

4. **Migration for Existing Admin Keypairs**
   - Existing admin keypairs are NOT automatically converted to seed-based
   - When admin creates new seed-based admin keypair, must explicitly choose seed-based generation
   - Optionally, admin can create a seed and re-generate existing keypairs from it (requires manual process)

### Phase 2: Remote Signing Integration

#### Architecture

```
┌─────────────────────┐
│  Electron App       │
│  (Main Process)     │
└──────────┬──────────┘
           │
           │ Signing Request
           │ (Event Hash, Tags)
           ↓
┌─────────────────────┐
│  Signing Adapter    │
│  (Abstract Layer)   │
└──────────┬──────────┘
           │
     ┌─────┴─────┬─────────────┬──────────────┐
     │           │             │              │
     ↓           ↓             ↓              ↓
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐
│  Local  │ │ Hardware│ │  Mobile  │ │  Ceramic │
│ Signing │ │ Wallet  │ │  Wallet  │ │  Wallet  │
└─────────┘ └─────────┘ └──────────┘ └──────────┘
```

#### Signing Adapter Interface

```javascript
class SigningAdapter {
  /**
   * Check if adapter supports the given wallet type
   */
  supports(walletType) { }

  /**
   * Connect to wallet device/service
   */
  async connect(walletConfig) { }

  /**
   * Sign a Nostr event
   * @param {string} eventHash - SHA256 hash of event
   * @param {Array} tags - Event tags
   * @param {number} kind - Event kind
   * @param {string} content - Event content
   * @returns {Promise<string>} Signature hex string
   */
  async signEvent(eventHash, tags, kind, content) { }

  /**
   * Get public key for this keypair
   * @returns {Promise<string>} Public key hex
   */
  async getPublicKey() { }

  /**
   * Disconnect from wallet
   */
  async disconnect() { }
}
```

#### Implementation Steps

1. **Create Signing Adapter Framework**
   - Abstract base class for all signing methods
   - Factory pattern to create appropriate adapter
   - Error handling and retry logic
   - Connection pooling for hardware devices

2. **Implement Local Signing Adapter**
   - Decrypt private key from database using Profile Guard
   - Use `nostr-tools` or similar library for signing
   - This is the existing behavior, now abstracted

3. **Implement Hardware Wallet Adapters**

   **Ledger Adapter:**
   ```javascript
   import Transport from '@ledgerhq/hw-transport-node-hid';
   // For Nostr, may need custom app or use generic signing
   
   class LedgerSigningAdapter extends SigningAdapter {
     async connect(config) {
       this.transport = await Transport.open();
       // Initialize Nostr app on device
     }
     
     async signEvent(eventHash, tags, kind, content) {
       // Send event hash to device
       // Device signs with stored private key
       // Return signature
     }
   }
   ```

   **Trezor Adapter:**
   ```javascript
   import TrezorConnect from '@trezor/connect';
   
   class TrezorSigningAdapter extends SigningAdapter {
     async connect(config) {
       await TrezorConnect.init({
         manifest: { appUrl: '...', email: '...' }
       });
     }
     
     async signEvent(eventHash, tags, kind, content) {
       // Use Trezor Connect API
       // May need custom message signing format
     }
   }
   ```

4. **Implement Mobile Wallet Adapters (NIP-46)**

   NIP-46 (Remote Signing) is a protocol for remote Nostr key signing:
   
   ```javascript
   class NIP46SigningAdapter extends SigningAdapter {
     async connect(config) {
       // Establish WebSocket connection to mobile wallet
       // Exchange encryption keys
       // Authenticate using shared secret or QR code
     }
     
     async signEvent(eventHash, tags, kind, content) {
       // Send signing request via NIP-46 protocol
       // Wait for approval on mobile device
       // Receive signature
     }
   }
   ```

5. **Update Keypair Management UI**

   - Add "Remote Signing" option when creating/administering keypairs
   - Wallet type selector (Hardware/Mobile/Ceramic)
   - Connection test button
   - Display connection status
   - Show public key verification

### Phase 3: Seed Export and Import

1. **Export Seed to Remote Wallet**
   - User selects seed-based keypair
   - Generate export package (encrypted or unencrypted based on security level)
   - Provide QR code or file for wallet import
   - Mark keypair as `seed_export_ready=1`
   - Optionally mark as remote after export

2. **Import from Remote Wallet**
   - Connect to remote wallet
   - Extract public key
   - Create keypair record with `is_remote_signing=1`
   - Store wallet type and connection metadata

## Facilitating Remote Signing for Existing Hardware Wallets

### For Users with Ledger/Trezor Devices

1. **Detection and Setup**
   - Detect connected hardware wallets on app startup
   - Offer to configure existing device for Nostr signing
   - Guide user through setup process

2. **Key Derivation Compatibility**
   - Use standard BIP44 path: `m/44'/1237'/0'/0/0` for Nostr
   - Support custom derivation paths if user has existing setup
   - Allow users to specify derivation path during setup

3. **Nostr App Installation (if needed)**
   - Guide users to install Nostr app on hardware device (if available)
   - Provide fallback to generic message signing if dedicated app unavailable
   - Document conversion process for generic signatures

### For Users with Mobile Wallets

1. **NIP-46 Integration**
   - Implement full NIP-46 (Remote Signing) protocol support
   - QR code pairing for initial connection
   - Persistent connection management
   - Handle mobile app lifecycle (background/foreground)

2. **Connection Management**
   - Store connection metadata in `remote_wallet_metadata`
   - Support reconnection after app restart
   - Handle connection timeouts gracefully
   - Provide connection status indicators

## Security Considerations

1. **Private Key Never Leaves Device**
   - Hardware wallets: Private key never exposed to computer
   - Mobile wallets: Private key stays in secure enclave/keychain
   - Only signatures are transmitted

2. **Transaction Verification**
   - Display event details on hardware wallet screen before signing
   - Require user approval for each signing operation
   - Log all signing requests for audit trail

3. **Connection Security**
   - Use encrypted channels for mobile wallet communication
   - Verify device identity before first use
   - Implement replay attack prevention
   - Use time-limited connection tokens

4. **Backup and Recovery**
   - For seed-based keypairs: Master seed backup is critical
   - For hardware wallets: Recovery seed phrase is user's responsibility
   - Provide clear backup instructions
   - Warn users about loss of access risks

## Recommended Implementation Order

1. **Start with Seed-Based Generation** (Foundation)
   - Implement master seed storage and encryption
   - Add seed-based keypair derivation
   - Test with local signing first

2. **Add NIP-46 Mobile Wallet Support** (Easiest)
   - NIP-46 is well-defined protocol
   - Good user experience with mobile apps
   - Lower barrier to entry than hardware wallets

3. **Add Hardware Wallet Support** (Most Secure)
   - Ledger support (better ecosystem)
   - Trezor support (open source alternative)
   - Handle device-specific quirks

4. **Add Ceramic/Web3 Integration** (Optional)
   - If user demand exists
   - For advanced use cases
   - Evaluate security vs. convenience trade-offs

## Testing Strategy

1. **Unit Tests**
   - Signing adapter interface compliance
   - Key derivation correctness
   - Encryption/decryption of master seed

2. **Integration Tests**
   - Hardware device communication
   - Mobile wallet NIP-46 protocol
   - Error handling and reconnection

3. **User Acceptance Testing**
   - Setup workflows for each wallet type
   - Signing operations for different event types
   - Edge cases (device disconnected, app closed, etc.)

## Documentation Requirements

1. **User Guide**
   - How to set up hardware wallet
   - How to pair mobile wallet
   - Troubleshooting common issues

2. **Developer Documentation**
   - Signing adapter interface
   - Adding new wallet types
   - Security best practices

3. **Admin Guide**
   - Setting up admin keypairs with remote signing
   - Best practices for key management
   - Disaster recovery procedures

## Future Enhancements

1. **Multi-Signature Support**
   - Require multiple devices to sign
   - Use for high-security admin operations

2. **Key Rotation**
   - Seamless rotation of remote signing keys
   - Update trust declarations and delegations

3. **Wallet Agnostic Protocol**
   - Standardize signing requests across wallet types
   - Allow easy switching between wallet types

4. **Hardware Security Module (HSM) Support**
   - Enterprise-grade key management
   - FIPS 140-2 compliant options
   - Network-attached HSM integration

---

## References

- [NIP-46: Nostr Remote Signing](https://github.com/nostr-protocol/nips/blob/master/46.md)
- [BIP-32: Hierarchical Deterministic Wallets](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
- [BIP-44: Multi-Account Hierarchy](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)
- [Ledger Developer Documentation](https://developers.ledger.com/)
- [Trezor Developer Documentation](https://docs.trezor.io/)
- [Ceramic Network Documentation](https://developers.ceramic.network/)

