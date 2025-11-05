# Admin Declarations Schema Plan

## Overview

This document defines the versioned JSON-based schema for `content_json` in the `admindeclarations` table, along with planned database table updates to support Nostr publishing and peer-to-peer distribution of admin declarations.

## Purpose

Admin declarations are digitally signed statements issued by Master Admin Keypairs that establish trust relationships, grant privileges, delegate powers, issue moderation actions, and authorize metadata updates. These declarations form the foundation of the decentralized trust and authority system for the game rating platform.

## Goals

1. **Trust Relationships**: Establish trust between admin keypairs, operational admins, and user profiles
2. **Privilege Management**: Grant or revoke privileges to users and profiles
3. **Delegation**: Delegate moderation powers and metadata update authorities
4. **Moderation Actions**: Issue blocking, freezing, and other moderation directives
5. **Metadata Updates**: Authorize specific users to update game metadata
6. **Nostr Publishing**: Publish declarations to Nostr relays for peer-to-peer distribution
7. **Extensibility**: Support future use cases (forum moderation, messaging controls, etc.)

---

## Versioned JSON Schema

### Schema Versioning

All admin declarations MUST include a `schema_version` field indicating the schema version. This allows for backward compatibility and schema evolution.

**Current Schema Version: `1.0`**

### Base Schema Structure

```json
{
  "schema_version": "1.0",
  "declaration_type": "trust-declaration|privilege-grant|privilege-revoke|moderation-action|metadata-delegation|admin-control-message|declaration-update|declaration-revoke",
  "declaration_id": "uuid",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1...",
    "fingerprint": "sha256...",
    "keypair_uuid": "uuid"
  },
  "subject": {
    "type": "keypair|profile|user|system|declaration",
    "canonical_name": "npub1...",
    "fingerprint": "sha256...",
    "keypair_uuid": "uuid",
    "profile_uuid": "uuid",
    "declaration_uuid": "uuid"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    // Type-specific content (see below)
    // All fields should be marked as critical or non-critical
  },
  "metadata": {
    "reason": "Optional explanation",
    "notes": "Optional internal notes"
  },
  "field_importance": {
    // Maps field paths to critical/non-critical flags
    // Example: { "content.permissions.can_moderate": "critical", "content.metadata.reason": "non-critical" }
  }
}
```

### Schema Evolution and Backward Compatibility

**Critical vs Non-Critical Fields**:

- **Critical Fields**: Must be understood by client. If unknown, client MUST reject declaration.
- **Non-Critical Fields**: Can be ignored if unknown. Client processes declaration but may skip unknown non-critical options.

**Field Importance Marking**:

```json
{
  "field_importance": {
    "content.trust_level": "critical",
    "content.permissions.can_moderate": "critical",
    "content.scopes.type": "critical",
    "content.metadata.reason": "non-critical",
    "content.metadata.notes": "non-critical",
    "content.max_delegation_duration": "non-critical"
  }
}
```

**Client Processing Rules**:

1. Parse `schema_version` from declaration
2. If client supports schema version:
   - Process all fields normally
3. If client doesn't support schema version:
   - Check `field_importance` for each field
   - If any critical field is unknown → **REJECT** declaration
   - If all unknown fields are non-critical → **PROCESS** declaration (skip unknown fields)
   - Log unknown fields for future compatibility

**Example Client Logic**:

```javascript
function processDeclaration(declaration, clientSchemaVersion) {
  const schemaVersion = declaration.schema_version;
  const fieldImportance = declaration.field_importance || {};
  
  if (clientSchemaVersion >= schemaVersion) {
    // Full support, process all fields
    return processFully(declaration);
  }
  
  // Check for unknown critical fields
  const unknownFields = findUnknownFields(declaration, clientSchemaVersion);
  for (const fieldPath of unknownFields) {
    const importance = fieldImportance[fieldPath] || 'critical'; // Default to critical
    if (importance === 'critical') {
      console.warn(`Rejecting declaration: unknown critical field ${fieldPath}`);
      return { accepted: false, reason: `Unknown critical field: ${fieldPath}` };
    }
  }
  
  // All unknown fields are non-critical, process with known fields only
  return processPartially(declaration, knownFields);
}
```

---

## Declaration Update and Revocation

### Declaration Update (`declaration-update`)

**Purpose**: Modify an existing declaration (add expiration, change permissions, update scope, etc.).

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-update",
  "declaration_id": "ee0e8400-e29b-41d4-a716-446655440009",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "canonical_name": null,
    "fingerprint": null
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "update_type": "add-expiration|modify-permissions|modify-scope|retroactive-void",
    "changes": {
      "validity": {
        "valid_until": 1730659456
      },
      "content": {
        "permissions": {
          "can_moderate": false,
          "can_update_metadata": true
        },
        "scopes": {
          "type": "channel",
          "targets": ["general", "help"]
        }
      }
    },
    "retroactive_effect": {
      "enabled": false,
      "effective_from": null
    }
  },
  "metadata": {
    "reason": "Adding expiration date to previously indefinite trust declaration",
    "notes": "Operational admin will need renewal after 1 year"
  },
  "field_importance": {
    "content.update_type": "critical",
    "content.changes.validity.valid_until": "critical",
    "content.changes.content.permissions": "critical",
    "content.retroactive_effect.enabled": "critical",
    "content.metadata.reason": "non-critical"
  }
}
```

**Example 1: Add Expiration Date to Indefinite Declaration**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-update",
  "declaration_id": "ff0e8400-e29b-41d4-a716-446655440010",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "update_type": "add-expiration",
    "changes": {
      "validity": {
        "valid_until": 1730659456
      }
    },
    "retroactive_effect": {
      "enabled": false
    }
  },
  "metadata": {
    "reason": "Adding 1-year expiration to previously indefinite trust declaration"
  },
  "field_importance": {
    "content.update_type": "critical",
    "content.changes.validity.valid_until": "critical",
    "content.retroactive_effect.enabled": "critical"
  }
}
```

**Example 2: Retroactively Void Declaration After Date**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-update",
  "declaration_id": "110e8400-e29b-41d4-a716-446655440011",
  "issued_at": 1699209856,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699209856,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "update_type": "retroactive-void",
    "changes": {
      "validity": {
        "valid_until": 1699123456
      }
    },
    "retroactive_effect": {
      "enabled": true,
      "effective_from": 1699123456,
      "void_actions_after": true
    }
  },
  "metadata": {
    "reason": "Retroactively voiding trust due to security breach discovered on 2024-01-15",
    "notes": "All actions taken by this keypair after 2024-01-10 are considered invalid"
  },
  "field_importance": {
    "content.update_type": "critical",
    "content.retroactive_effect.enabled": "critical",
    "content.retroactive_effect.effective_from": "critical",
    "content.retroactive_effect.void_actions_after": "critical"
  }
}
```

**Example 3: Modify Permissions and Scope**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-update",
  "declaration_id": "220e8400-e29b-41d4-a716-446655440012",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "update_type": "modify-permissions",
    "changes": {
      "content": {
        "permissions": {
          "can_moderate": true,
          "can_update_metadata": false,
          "max_block_duration": 172800
        },
        "scopes": {
          "type": "channel",
          "targets": ["general"],
          "exclude": []
        }
      }
    },
    "retroactive_effect": {
      "enabled": false
    }
  },
  "metadata": {
    "reason": "Restricting operational admin to moderation only, removing metadata update powers",
    "notes": "Scope limited to #general channel only"
  },
  "field_importance": {
    "content.update_type": "critical",
    "content.changes.content.permissions": "critical",
    "content.changes.content.scopes": "critical"
  }
}
```

---

### Declaration Revoke (`declaration-revoke`)

**Purpose**: Completely revoke/cancel a declaration, optionally with retroactive effect.

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-revoke",
  "declaration_id": "330e8400-e29b-41d4-a716-446655440013",
  "issued_at": 1699209856,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699209856,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "revocation_type": "immediate|retroactive|future",
    "effective_from": 1699209856,
    "retroactive_effect": {
      "enabled": false,
      "void_actions_after": null,
      "void_actions_from": null
    },
    "cascade_revoke": {
      "enabled": false,
      "revoke_delegations": false,
      "revoke_privileges": false
    }
  },
  "metadata": {
    "reason": "Operational admin keypair compromised",
    "notes": "All delegations issued by this admin should be reviewed"
  },
  "field_importance": {
    "content.target_declaration_uuid": "critical",
    "content.revocation_type": "critical",
    "content.effective_from": "critical",
    "content.retroactive_effect.enabled": "critical",
    "content.cascade_revoke.enabled": "non-critical"
  }
}
```

**Example 1: Immediate Revocation**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-revoke",
  "declaration_id": "440e8400-e29b-41d4-a716-446655440014",
  "issued_at": 1699209856,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699209856,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "revocation_type": "immediate",
    "effective_from": 1699209856,
    "retroactive_effect": {
      "enabled": false
    },
    "cascade_revoke": {
      "enabled": false
    }
  },
  "metadata": {
    "reason": "Operational admin no longer needed"
  },
  "field_importance": {
    "content.target_declaration_uuid": "critical",
    "content.revocation_type": "critical",
    "content.effective_from": "critical"
  }
}
```

**Example 2: Retroactive Revocation with Void Actions**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-revoke",
  "declaration_id": "550e8400-e29b-41d4-a716-446655440015",
  "issued_at": 1699209856,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699209856,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "revocation_type": "retroactive",
    "effective_from": 1699123456,
    "retroactive_effect": {
      "enabled": true,
      "void_actions_after": 1699123456,
      "void_actions_from": 1699123456
    },
    "cascade_revoke": {
      "enabled": true,
      "revoke_delegations": true,
      "revoke_privileges": false
    }
  },
  "metadata": {
    "reason": "Security breach discovered - keypair compromised on 2024-01-10",
    "notes": "All actions taken after compromise date are invalid. All delegations issued by this admin are revoked."
  },
  "field_importance": {
    "content.target_declaration_uuid": "critical",
    "content.revocation_type": "critical",
    "content.retroactive_effect.enabled": "critical",
    "content.retroactive_effect.void_actions_after": "critical",
    "content.cascade_revoke.enabled": "critical"
  }
}
```

**Example 3: Future Revocation (Cancel Trust After Date)**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-revoke",
  "declaration_id": "660e8400-e29b-41d4-a716-446655440016",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "revocation_type": "future",
    "effective_from": 1730659456,
    "retroactive_effect": {
      "enabled": false
    },
    "cascade_revoke": {
      "enabled": false
    }
  },
  "metadata": {
    "reason": "Trust will be canceled after 1 year unless renewed",
    "notes": "Scheduled revocation for 2025-01-01"
  },
  "field_importance": {
    "content.target_declaration_uuid": "critical",
    "content.revocation_type": "critical",
    "content.effective_from": "critical"
  }
}
```

---

## Declaration Types and Content Schemas

### 1. Trust Declaration (`trust-declaration`)

**Purpose**: Establish trust relationships between admin keypairs and operational admins.

#### Trust Level Hierarchy

The `trust_level` field supports the following values, in descending order of privilege:

1. **`operating-admin`**: Full administrative privileges. Can sign trust declarations for other admins and moderators. Can delegate moderation powers and metadata update authorities. Can sign New Delegations, Updates, and Revocations for all trust levels.

2. **`authorized-admin`**: Administrative privileges with restrictions. Almost the same as Operating Admin, but with the following limitations:
   - **Cannot sign New Delegations, Updates, or Revocations** that affect Master Admin or Operating Admin objects
   - Can revoke or modify any Moderator, Updater, or Contributor level declarations
   - Can only revoke or reduce Authorized Admin declarations that rely upon their signature
   - **Cannot sign a declaration granting a permission or privilege they don't possess**
   - When signing an Authorized Admin declaration, can only grant:
     - Same or fewer privileges than they possess
     - Same or narrower scope than they possess
     - Same or reduced validity period than their own declaration
   - Within their scope, can perform moderation actions, metadata updates, and other administrative tasks

3. **`moderator`**: Can moderate content and manage user interactions within their scope. Cannot sign trust declarations or delegate powers.

4. **`updater`**: Can update metadata within their scope. Cannot sign trust declarations, moderate, or delegate powers.

5. **`contributor`**: Limited contributor role. Can contribute content within their scope. Cannot sign trust declarations, moderate, update metadata, or delegate powers.

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "trust-declaration",
  "declaration_id": "550e8400-e29b-41d4-a716-446655440000",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "keypair",
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1730659456
  },
  "content": {
    "trust_level": "operating-admin|authorized-admin|moderator|updater|contributor",
    "usage_types": ["signing", "moderation", "metadata-updates"],
    "scopes": {
      "type": "global|global-chat|global-forum|channel|forum|game",
      "targets": ["general", "help", "game:9671"],
      "exclude": []
    },
    "permissions": {
      "can_sign_trust_declarations": false,
      "can_sign_operational_admins": true,
      "can_moderate": true,
      "can_update_metadata": true,
      "can_delegate_moderators": true,
      "can_delegate_updaters": true,
      "max_delegation_duration": 2592000,
      "max_block_duration": 86400
    },
    "required_countersignatures": {
      "min_count": 3,
      "required_keys": [
        "npub1master1...",
        "npub1master2...",
        "npub1master3..."
      ]
    }
  },
  "metadata": {
    "reason": "Trusted community moderator for game-specific forums",
    "notes": "Has been active for 2 years, handles technical support forums"
  },
  "field_importance": {
    "content.trust_level": "critical",
    "content.usage_types": "critical",
    "content.permissions.can_moderate": "critical",
    "content.required_countersignatures.min_count": "critical",
    "content.metadata.reason": "non-critical",
    "content.metadata.notes": "non-critical"
  }
}
```

**Example: Authorized Admin Trust Declaration**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "trust-declaration",
  "declaration_id": "770e8400-e29b-41d4-a716-446655440001",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "keypair",
    "canonical_name": "npub1authadmin789...",
    "fingerprint": "9876543210ab...",
    "keypair_uuid": "authorized-admin-uuid-1"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1730659456
  },
  "content": {
    "trust_level": "authorized-admin",
    "usage_types": ["moderation", "metadata-updates"],
    "scopes": {
      "type": "channel",
      "targets": ["general", "help"],
      "exclude": []
    },
    "permissions": {
      "can_sign_trust_declarations": false,
      "can_sign_operational_admins": false,
      "can_moderate": true,
      "can_update_metadata": true,
      "can_delegate_moderators": true,
      "can_delegate_updaters": true,
      "max_delegation_duration": 2592000,
      "max_block_duration": 86400
    }
  },
  "metadata": {
    "reason": "Trusted community member granted authorized admin privileges for channel moderation and metadata updates",
    "notes": "Restricted scope: cannot sign declarations affecting Master Admin or Operating Admin objects"
  },
  "field_importance": {
    "content.trust_level": "critical",
    "content.usage_types": "critical",
    "content.permissions.can_sign_operational_admins": "critical",
    "content.scopes.type": "critical"
  }
}
```

**Example: Multi-Signature Trust Declaration**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "trust-declaration",
  "declaration_id": "660e8400-e29b-41d4-a716-446655440001",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "keypair",
    "canonical_name": "npub1opadmin789...",
    "fingerprint": "9876543210ab...",
    "keypair_uuid": "operational-admin-uuid-2"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "trust_level": "operating-admin",
    "usage_types": ["signing", "moderation", "metadata-updates", "delegation"],
    "scopes": {
      "type": "global"
    },
    "permissions": {
      "can_sign_trust_declarations": false,
      "can_sign_operational_admins": true,
      "can_moderate": true,
      "can_update_metadata": true,
      "can_delegate_moderators": true,
      "can_delegate_updaters": true,
      "max_delegation_duration": 2592000,
      "max_block_duration": 2592000
    },
    "required_countersignatures": {
      "min_count": 3,
      "required_keys": [
        "npub1masteradmin123...",
        "npub1masteradmin456...",
        "npub1masteradmin789..."
      ],
      "current_signatures": [
        {
          "canonical_name": "npub1masteradmin123...",
          "fingerprint": "a1b2c3d4e5f6...",
          "signed_at": 1699123456,
          "signature": "sig1..."
        },
        {
          "canonical_name": "npub1masteradmin456...",
          "fingerprint": "b2c3d4e5f6a1...",
          "signed_at": 1699123457,
          "signature": "sig2..."
        }
      ]
    }
  },
  "metadata": {
    "reason": "Promoting trusted moderator to operational admin with full powers"
  },
  "field_importance": {
    "content.trust_level": "critical",
    "content.usage_types": "critical",
    "content.permissions": "critical",
    "content.required_countersignatures.min_count": "critical",
    "content.required_countersignatures.current_signatures": "critical"
  }
}
```

---

### 2. Privilege Grant (`privilege-grant`)

**Purpose**: Grant specific privileges to user profiles.

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "privilege-grant",
  "declaration_id": "770e8400-e29b-41d4-a716-446655440002",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "subject": {
    "type": "profile",
    "canonical_name": "npub1user789...",
    "fingerprint": "user789fingerprint...",
    "profile_uuid": "user-profile-uuid-1"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1702123456
  },
  "content": {
    "privileges": [
      {
        "type": "access-level",
        "level": "premium",
        "description": "Premium tier access to exclusive forums"
      },
      {
        "type": "role",
        "role": "contributor",
        "description": "Can contribute game metadata"
      },
      {
        "type": "permission",
        "permission": "create-private-channels",
        "description": "Can create private chat channels"
      }
    ],
    "scopes": {
      "type": "global",
      "targets": []
    },
    "conditions": {
      "requires_verification": true,
      "requires_premium": false
    }
  },
  "metadata": {
    "reason": "Rewarding active community contributor with premium access",
    "notes": "User has provided 50+ high-quality game reviews"
  },
  "field_importance": {
    "content.privileges": "critical",
    "content.scopes.type": "critical",
    "content.conditions.requires_verification": "critical",
    "content.metadata.reason": "non-critical"
  }
}
```

---

### 3. Privilege Revoke (`privilege-revoke`)

**Purpose**: Revoke previously granted privileges.

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "privilege-revoke",
  "declaration_id": "880e8400-e29b-41d4-a716-446655440003",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "subject": {
    "type": "profile",
    "canonical_name": "npub1user789...",
    "fingerprint": "user789fingerprint...",
    "profile_uuid": "user-profile-uuid-1"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "revoked_privileges": [
      {
        "type": "access-level",
        "level": "premium",
        "original_grant_declaration_id": "770e8400-e29b-41d4-a716-446655440002",
        "revoked_at": 1699123456
      }
    ],
    "reason": "Violation of community guidelines",
    "appeal_allowed": true,
    "appeal_after": 1699209856
  },
  "metadata": {
    "reason": "User posted spam in multiple forums",
    "notes": "First offense, warning issued. Premium access revoked for 30 days."
  },
  "field_importance": {
    "content.revoked_privileges": "critical",
    "content.reason": "critical",
    "content.appeal_allowed": "non-critical",
    "content.metadata.notes": "non-critical"
  }
}
```

---

### 4. Moderation Action (`moderation-action`)

**Purpose**: Issue moderation directives (blocks, freezes, warnings, etc.).

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "moderation-action",
  "declaration_id": "990e8400-e29b-41d4-a716-446655440004",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "subject": {
    "type": "profile",
    "canonical_name": "npub1user789...",
    "fingerprint": "user789fingerprint...",
    "profile_uuid": "user-profile-uuid-1"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1699209856
  },
  "content": {
    "action_type": "block|freeze|warn|mute|hide|delete",
    "target_type": "user|channel|forum|post|message",
    "target_id": "user-profile-uuid-1|channel:general|forum:strategy|post:uuid|message:uuid",
    "scope": {
      "type": "global|global-chat|global-forum|channel|forum|post",
      "targets": ["general", "help"]
    },
    "restrictions": {
      "block_posting": true,
      "block_reading": false,
      "hide_history": true,
      "auto_delete": false,
      "freeze_channel": false
    },
    "details": {
      "reason": "Spam posting in multiple channels",
      "public_reason": "Violating community guidelines",
      "private_notes": "Pattern of spam links detected across 5 channels",
      "severity": "medium",
      "evidence": ["event_id_1", "event_id_2", "event_id_3"]
    },
    "appeal": {
      "can_appeal": true,
      "appeal_after": 1699209856,
      "appeal_contact": "admin@example.com"
    }
  },
  "metadata": {
    "reason": "Automated detection triggered manual review",
    "notes": "User has been warned twice before"
  },
  "field_importance": {
    "content.action_type": "critical",
    "content.target_type": "critical",
    "content.scope.type": "critical",
    "content.restrictions.block_posting": "critical",
    "content.details.reason": "critical",
    "content.details.public_reason": "critical",
    "content.details.private_notes": "non-critical",
    "content.appeal.can_appeal": "non-critical"
  }
}
```

**Example: Channel Freeze**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "moderation-action",
  "declaration_id": "aa0e8400-e29b-41d4-a716-446655440005",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "subject": {
    "type": "channel",
    "canonical_name": null,
    "fingerprint": null,
    "target_id": "channel:general"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1699127056
  },
  "content": {
    "action_type": "freeze",
    "target_type": "channel",
    "target_id": "channel:general",
    "scope": {
      "type": "channel",
      "targets": ["general"]
    },
    "restrictions": {
      "freeze_channel": true,
      "block_posting": true,
      "block_reading": true
    },
    "details": {
      "reason": "Maintenance and cleanup",
      "public_reason": "Channel temporarily unavailable for maintenance",
      "severity": "low"
    }
  },
  "metadata": {
    "reason": "Scheduled maintenance window"
  },
  "field_importance": {
    "content.action_type": "critical",
    "content.target_type": "critical",
    "content.target_id": "critical",
    "content.restrictions.freeze_channel": "critical",
    "content.details.reason": "critical"
  }
}
```

---

### 5. Metadata Delegation (`metadata-delegation`)

**Purpose**: Delegate authority to update game metadata.

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "metadata-delegation",
  "declaration_id": "bb0e8400-e29b-41d4-a716-446655440006",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "subject": {
    "type": "profile",
    "canonical_name": "npub1user789...",
    "fingerprint": "user789fingerprint...",
    "profile_uuid": "user-profile-uuid-1"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1702123456
  },
  "content": {
    "delegation_type": "metadata-updater",
    "game_scope": {
      "type": "all|new|specific",
      "gameids": ["9671", "9672"]
    },
    "version_scope": {
      "type": "all|latest|specific",
      "versions": []
    },
    "allowed_operations": {
      "can_create_new_games": false,
      "can_update_existing": true,
      "can_publish_versions": false,
      "can_delete": false
    },
    "field_restrictions": {
      "type": "whitelist|blacklist|all",
      "allowed_fields": [
        "description",
        "tags",
        "moderated",
        "featured"
      ],
      "restricted_fields": []
    },
    "max_update_frequency": {
      "per_game_per_day": 10,
      "per_day_total": 100
    }
  },
  "metadata": {
    "reason": "Trusted community member for game metadata curation",
    "notes": "Has been contributing accurate metadata for 6 months"
  },
  "field_importance": {
    "content.delegation_type": "critical",
    "content.game_scope.type": "critical",
    "content.allowed_operations.can_update_existing": "critical",
    "content.field_restrictions.type": "critical",
    "content.max_update_frequency": "non-critical",
    "content.metadata.notes": "non-critical"
  }
}
```

---

### 6. Admin Control Message (`admin-control-message`)

**Purpose**: Issue administrative control directives (channel creation, forum management, permission updates, etc.).

**Content Schema**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "admin-control-message",
  "declaration_id": "cc0e8400-e29b-41d4-a716-446655440007",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "subject": {
    "type": "system",
    "canonical_name": null,
    "fingerprint": null
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "message_type": "channel-create|channel-update|channel-delete|forum-create|forum-update|forum-delete|permission-set|permission-revoke",
    "target": {
      "type": "channel|forum|permission",
      "id": "channel:general|forum:strategy|permission:chat:general"
    },
    "action": {
      "channel_data": {
        "channel_id": "general",
        "name": "#general",
        "topic": "General discussion",
        "settings": {
          "read_access": "public",
          "write_access": "verified",
          "encryption": "public"
        }
      },
      "forum_data": {
        "forum_id": "strategy",
        "name": "Strategy & Tips",
        "settings": {
          "read_access": "public",
          "post_access": "verified"
        }
      },
      "permission_data": {
        "scope": "channel",
        "target": "general",
        "rules": {
          "read": {
            "default": "allow",
            "require": []
          },
          "write": {
            "default": "require",
            "require": ["verified"]
          }
        }
      }
    }
  },
  "metadata": {
    "reason": "Creating new channel for community discussions",
    "notes": "Channel will be public with verified write access"
  },
  "field_importance": {
    "content.message_type": "critical",
    "content.target.type": "critical",
    "content.action.channel_data": "critical",
    "content.action.forum_data": "critical",
    "content.action.permission_data": "critical"
  }
}
```

**Example: Permission Update**:

```json
{
  "schema_version": "1.0",
  "declaration_type": "admin-control-message",
  "declaration_id": "dd0e8400-e29b-41d4-a716-446655440008",
  "issued_at": 1699123456,
  "issuer": {
    "canonical_name": "npub1opadmin456...",
    "fingerprint": "f6e5d4c3b2a1...",
    "keypair_uuid": "operational-admin-uuid-1"
  },
  "subject": {
    "type": "system"
  },
  "validity": {
    "valid_from": 1699123456,
    "valid_until": null
  },
  "content": {
    "message_type": "permission-set",
    "target": {
      "type": "permission",
      "id": "permission:chat:general"
    },
    "action": {
      "permission_data": {
        "scope": "channel",
        "target": "general",
        "rules": {
          "read": {
            "default": "allow",
            "require": [],
            "allowed_users": [],
            "denied_users": []
          },
          "write": {
            "default": "require",
            "require": ["verified", "premium"],
            "allowed_users": [],
            "denied_users": []
          }
        }
      }
    }
  },
  "metadata": {
    "reason": "Updating channel permissions to require premium for posting"
  },
  "field_importance": {
    "content.message_type": "critical",
    "content.target.type": "critical",
    "content.action.permission_data": "critical"
  }
}
```

---

## Database Table Updates for Nostr Publishing

### Current `admindeclarations` Table

The current table structure is:

```sql
CREATE TABLE admindeclarations (
    declaration_uuid VARCHAR(255) PRIMARY KEY,
    declaration_type VARCHAR(50) NOT NULL,
    content_json TEXT NOT NULL,
    content_hash_sha256 VARCHAR(64) NOT NULL,
    digital_signature TEXT NOT NULL,
    signing_keypair_uuid VARCHAR(255),
    signing_keypair_fingerprint TEXT,
    target_keypair_uuid VARCHAR(255),
    target_keypair_fingerprint TEXT,
    target_user_profile_id VARCHAR(255),
    valid_from TIMESTAMP,
    valid_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Proposed Updates

#### 1. Nostr Publishing Fields

Add fields to track Nostr event publishing:

```sql
ALTER TABLE admindeclarations ADD COLUMN nostr_event_id VARCHAR(64);
ALTER TABLE admindeclarations ADD COLUMN nostr_published_at TIMESTAMP;
ALTER TABLE admindeclarations ADD COLUMN nostr_published_to_relays TEXT; -- JSON array of relay URLs
ALTER TABLE admindeclarations ADD COLUMN nostr_publish_status VARCHAR(50) DEFAULT 'pending'; -- pending, published, failed, retrying
ALTER TABLE admindeclarations ADD COLUMN nostr_kind INTEGER; -- Nostr event kind (e.g., 31106 for admin declarations)
ALTER TABLE admindeclarations ADD COLUMN nostr_tags TEXT; -- JSON array of Nostr tags
```

#### 2. Countersignature Support

Add fields to track multi-signature requirements:

```sql
ALTER TABLE admindeclarations ADD COLUMN required_countersignatures INTEGER DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN current_countersignatures INTEGER DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN countersignatures_json TEXT; -- JSON array of countersignatures
```

#### 3. Network Discovery

Add fields to track discovery from the network:

```sql
ALTER TABLE admindeclarations ADD COLUMN discovered_from_relay TEXT;
ALTER TABLE admindeclarations ADD COLUMN discovered_at TIMESTAMP;
ALTER TABLE admindeclarations ADD COLUMN is_local BOOLEAN DEFAULT 1; -- 1=created locally, 0=discovered from network
ALTER TABLE admindeclarations ADD COLUMN verification_status VARCHAR(50) DEFAULT 'pending'; -- pending, verified, failed
```

#### 4. Version and Schema Tracking

```sql
ALTER TABLE admindeclarations ADD COLUMN schema_version VARCHAR(10) DEFAULT '1.0';
ALTER TABLE admindeclarations ADD COLUMN content_version INTEGER DEFAULT 1; -- For tracking updates to same declaration
ALTER TABLE admindeclarations ADD COLUMN original_declaration_uuid VARCHAR(255); -- For updates/revokes that reference original
ALTER TABLE admindeclarations ADD COLUMN is_update BOOLEAN DEFAULT 0; -- 1=update/revoke, 0=original
ALTER TABLE admindeclarations ADD COLUMN update_chain_uuid VARCHAR(255); -- Links updates to same original declaration
```

#### 5. Update Tracking

Add fields to track declaration updates and revocations:

```sql
ALTER TABLE admindeclarations ADD COLUMN update_history_json TEXT; -- JSON array of update/revoke declarations
ALTER TABLE admindeclarations ADD COLUMN is_revoked BOOLEAN DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN revoked_at TIMESTAMP;
ALTER TABLE admindeclarations ADD COLUMN revoked_by_declaration_uuid VARCHAR(255);
ALTER TABLE admindeclarations ADD COLUMN retroactive_effect_enabled BOOLEAN DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN retroactive_effective_from TIMESTAMP;
```

#### 6. Indexes for Performance

```sql
CREATE INDEX idx_admindeclarations_nostr_event_id ON admindeclarations(nostr_event_id);
CREATE INDEX idx_admindeclarations_nostr_publish_status ON admindeclarations(nostr_publish_status);
CREATE INDEX idx_admindeclarations_discovered_at ON admindeclarations(discovered_at);
CREATE INDEX idx_admindeclarations_is_local ON admindeclarations(is_local);
CREATE INDEX idx_admindeclarations_verification_status ON admindeclarations(verification_status);
CREATE INDEX idx_admindeclarations_schema_version ON admindeclarations(schema_version);
```

### Complete Updated Table Schema

```sql
CREATE TABLE IF NOT EXISTS admindeclarations (
    declaration_uuid VARCHAR(255) PRIMARY KEY,
    schema_version VARCHAR(10) DEFAULT '1.0',
    content_version INTEGER DEFAULT 1,
    declaration_type VARCHAR(50) NOT NULL,
    content_json TEXT NOT NULL,
    content_hash_sha256 VARCHAR(64) NOT NULL,
    digital_signature TEXT NOT NULL,
    signing_keypair_uuid VARCHAR(255),
    signing_keypair_fingerprint TEXT,
    target_keypair_uuid VARCHAR(255),
    target_keypair_fingerprint TEXT,
    target_user_profile_id VARCHAR(255),
    valid_from TIMESTAMP,
    valid_until TIMESTAMP,
    
    -- Nostr Publishing
    nostr_event_id VARCHAR(64),
    nostr_published_at TIMESTAMP,
    nostr_published_to_relays TEXT, -- JSON array
    nostr_publish_status VARCHAR(50) DEFAULT 'pending',
    nostr_kind INTEGER DEFAULT 31106,
    nostr_tags TEXT, -- JSON array
    
    -- Countersignatures
    required_countersignatures INTEGER DEFAULT 0,
    current_countersignatures INTEGER DEFAULT 0,
    countersignatures_json TEXT, -- JSON array
    
    -- Network Discovery
    discovered_from_relay TEXT,
    discovered_at TIMESTAMP,
    is_local BOOLEAN DEFAULT 1,
    verification_status VARCHAR(50) DEFAULT 'pending',
    
    -- Update Tracking
    original_declaration_uuid VARCHAR(255),
    is_update BOOLEAN DEFAULT 0,
    update_chain_uuid VARCHAR(255),
    update_history_json TEXT,
    is_revoked BOOLEAN DEFAULT 0,
    revoked_at TIMESTAMP,
    revoked_by_declaration_uuid VARCHAR(255),
    retroactive_effect_enabled BOOLEAN DEFAULT 0,
    retroactive_effective_from TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_admindeclarations_type ON admindeclarations(declaration_type);
CREATE INDEX idx_admindeclarations_hash ON admindeclarations(content_hash_sha256);
CREATE INDEX idx_admindeclarations_signing_keypair ON admindeclarations(signing_keypair_uuid);
CREATE INDEX idx_admindeclarations_target_keypair ON admindeclarations(target_keypair_uuid);
CREATE INDEX idx_admindeclarations_target_user ON admindeclarations(target_user_profile_id);
CREATE INDEX idx_admindeclarations_validity ON admindeclarations(valid_from, valid_until);
CREATE INDEX idx_admindeclarations_nostr_event_id ON admindeclarations(nostr_event_id);
CREATE INDEX idx_admindeclarations_nostr_publish_status ON admindeclarations(nostr_publish_status);
CREATE INDEX idx_admindeclarations_discovered_at ON admindeclarations(discovered_at);
CREATE INDEX idx_admindeclarations_is_local ON admindeclarations(is_local);
CREATE INDEX idx_admindeclarations_verification_status ON admindeclarations(verification_status);
CREATE INDEX idx_admindeclarations_schema_version ON admindeclarations(schema_version);
```

---

## Nostr Event Structure

### Event Kind: `31106` (Admin Declarations)

**Rationale**: Custom kind for admin declarations, following the pattern of 31100-31105 used for chat/forums.

**Event Structure**:

```json
{
  "kind": 31106,
  "pubkey": "npub1issuingadmin...",
  "created_at": 1699123456,
  "tags": [
    ["d", "declaration:uuid:550e8400-e29b-41d4-a716-446655440000"],
    ["type", "trust-declaration"],
    ["subject", "npub1subjectadmin..."],
    ["subject_type", "keypair"],
    ["valid_from", "1699123456"],
    ["valid_until", "1730659456"],
    ["schema_version", "1.0"],
    ["app", "gameratings"],
    ["v", "1.0"]
  ],
  "content": "ENCRYPTED_OR_PUBLIC_CONTENT_JSON",
  "sig": "signature_of_event_hash"
}
```

**Content Encryption**:

- **Public Declarations**: Trust declarations, moderation actions (public), admin control messages (public) → Content is plain JSON
- **Private Declarations**: Privilege grants/revokes, moderation actions (private notes), metadata delegations → Content is encrypted with shared key or per-user encryption

**Encryption Strategy**:

```javascript
// Public declaration (trust declarations, public moderation actions)
const content = JSON.stringify(declarationContent);
const event = {
  kind: 31106,
  pubkey: issuerNpub,
  created_at: Math.floor(Date.now() / 1000),
  tags: [...],
  content: content, // Plain JSON
  sig: signEvent(event, issuerPrivateKey)
};

// Private declaration (privilege grants, private moderation notes)
const content = JSON.stringify(declarationContent);
const encrypted = encrypt(content, sharedKey); // or per-user encryption
const event = {
  kind: 31106,
  pubkey: issuerNpub,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["encryption", "shared"], // or "per-user"
    ...
  ],
  content: encrypted,
  sig: signEvent(event, issuerPrivateKey)
};
```

---

## Countersignature Process

### Multi-Signature Flow

1. **Initial Declaration**: First master admin creates declaration with `required_countersignatures: 3`
2. **Publish to Nostr**: Declaration published with `nostr_publish_status: 'pending'` (not yet valid)
3. **Countersignatures**: Other master admins discover and countersign
4. **Validation**: When `current_countersignatures >= required_countersignatures`, declaration becomes valid
5. **Status Update**: Update `nostr_publish_status: 'published'` and `verification_status: 'verified'`

### Countersignature JSON Structure

```json
{
  "countersignatures": [
    {
      "canonical_name": "npub1masteradmin123...",
      "fingerprint": "a1b2c3d4e5f6...",
      "keypair_uuid": "master-admin-uuid-1",
      "signed_at": 1699123456,
      "signature": "sig1...",
      "signature_hash_algorithm": "SHA-256",
      "signature_hash_value": "hash1..."
    },
    {
      "canonical_name": "npub1masteradmin456...",
      "fingerprint": "b2c3d4e5f6a1...",
      "keypair_uuid": "master-admin-uuid-2",
      "signed_at": 1699123457,
      "signature": "sig2...",
      "signature_hash_algorithm": "SHA-256",
      "signature_hash_value": "hash1..." // Same hash as original
    },
    {
      "canonical_name": "npub1masteradmin789...",
      "fingerprint": "c3d4e5f6a1b2...",
      "keypair_uuid": "master-admin-uuid-3",
      "signed_at": 1699123458,
      "signature": "sig3...",
      "signature_hash_algorithm": "SHA-256",
      "signature_hash_value": "hash1..." // Same hash as original
    }
  ]
}
```

---

## Discovery and Verification Process

### 1. Local Declaration Creation

1. Admin creates declaration locally
2. Signs with their keypair
3. Stores in database with `is_local: 1`, `nostr_publish_status: 'pending'`
4. Publishes to Nostr relays
5. Updates `nostr_publish_status: 'published'`, `nostr_published_at`, `nostr_published_to_relays`

### 2. Network Declaration Discovery

1. Client queries Nostr relays for kind `31106` events
2. Discovers new declarations
3. Verifies signature
4. Stores in database with `is_local: 0`, `discovered_from_relay`, `discovered_at`, `verification_status: 'verified'`
5. Applies declaration to local trust/permission system

### 3. Verification Rules

- **Signature Verification**: Verify `digital_signature` against `signing_keypair_fingerprint`
- **Hash Verification**: Verify `content_hash_sha256` matches hash of `content_json`
- **Validity Check**: Check `valid_from` and `valid_until` timestamps
- **Schema Validation**: Verify `schema_version` and JSON structure
- **Countersignature Check**: For multi-sig declarations, verify all required countersignatures

---

## Use Case Examples

### Example 1: Trust an Operational Admin

**Scenario**: Master admin wants to trust an operational admin for moderation.

1. Create trust declaration with `content_json`:
```json
{
  "schema_version": "1.0",
  "declaration_type": "trust-declaration",
  ...
  "content": {
    "trust_level": "operating-admin",
    "usage_types": ["moderation"],
    "scopes": { "type": "global" },
    "permissions": {
      "can_moderate": true,
      "can_delegate_moderators": true
    }
  }
}
```

2. Sign with master admin keypair
3. Publish to Nostr (kind 31106)
4. Other clients discover and verify
5. Operational admin can now moderate

### Example 2: Delegate Metadata Update Powers

**Scenario**: Admin wants to delegate game metadata update authority to a trusted user.

1. Create metadata delegation with `content_json`:
```json
{
  "schema_version": "1.0",
  "declaration_type": "metadata-delegation",
  ...
  "content": {
    "delegation_type": "metadata-updater",
    "game_scope": { "type": "specific", "gameids": ["9671"] },
    "allowed_operations": { "can_update_existing": true },
    "field_restrictions": {
      "type": "whitelist",
      "allowed_fields": ["description", "tags"]
    }
  }
}
```

2. Sign and publish
3. User can now update metadata for game 9671

### Example 3: Block a User

**Scenario**: Moderator wants to block a user for spam.

1. Create moderation action:
```json
{
  "schema_version": "1.0",
  "declaration_type": "moderation-action",
  ...
  "content": {
    "action_type": "block",
    "target_type": "user",
    "target_id": "user-profile-uuid-1",
    "scope": { "type": "global-chat" },
    "restrictions": { "block_posting": true },
    "details": {
      "reason": "Spam posting",
      "public_reason": "Violating community guidelines"
    }
  }
}
```

2. Sign with moderator's keypair (must have delegation)
3. Publish to Nostr
4. Clients discover and apply block

### Example 4: Create a Channel

**Scenario**: Admin wants to create a new chat channel.

1. Create admin control message:
```json
{
  "schema_version": "1.0",
  "declaration_type": "admin-control-message",
  ...
  "content": {
    "message_type": "channel-create",
    "target": { "type": "channel", "id": "channel:general" },
    "action": {
      "channel_data": {
        "channel_id": "general",
        "name": "#general",
        "settings": { "read_access": "public", "write_access": "verified" }
      }
    }
  }
}
```

2. Sign and publish
3. Clients discover and create channel

### Example 5: Update Declaration - Add Expiration

**Scenario**: Master admin wants to add an expiration date to a previously indefinite trust declaration.

1. Create declaration update:
```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-update",
  "declaration_id": "770e8400-e29b-41d4-a716-446655440017",
  "issued_at": 1699209856,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699209856,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "update_type": "add-expiration",
    "changes": {
      "validity": {
        "valid_until": 1730659456
      }
    },
    "retroactive_effect": {
      "enabled": false
    }
  },
  "metadata": {
    "reason": "Adding 1-year expiration to previously indefinite trust"
  },
  "field_importance": {
    "content.target_declaration_uuid": "critical",
    "content.update_type": "critical",
    "content.changes.validity.valid_until": "critical"
  }
}
```

2. Sign with master admin keypair
3. Publish to Nostr
4. Clients discover update and apply expiration to original declaration

### Example 6: Retroactively Cancel Trust

**Scenario**: Security breach discovered - need to retroactively void trust and all actions taken after breach date.

1. Create declaration revoke:
```json
{
  "schema_version": "1.0",
  "declaration_type": "declaration-revoke",
  "declaration_id": "880e8400-e29b-41d4-a716-446655440018",
  "issued_at": 1699209856,
  "issuer": {
    "canonical_name": "npub1masteradmin123...",
    "fingerprint": "a1b2c3d4e5f6...",
    "keypair_uuid": "master-admin-uuid-1"
  },
  "subject": {
    "type": "declaration",
    "declaration_uuid": "550e8400-e29b-41d4-a716-446655440000"
  },
  "validity": {
    "valid_from": 1699209856,
    "valid_until": null
  },
  "content": {
    "target_declaration_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "target_declaration_type": "trust-declaration",
    "revocation_type": "retroactive",
    "effective_from": 1699123456,
    "retroactive_effect": {
      "enabled": true,
      "void_actions_after": 1699123456,
      "void_actions_from": 1699123456
    },
    "cascade_revoke": {
      "enabled": true,
      "revoke_delegations": true,
      "revoke_privileges": false
    }
  },
  "metadata": {
    "reason": "Keypair compromised on 2024-01-10 - all actions after this date are invalid"
  },
  "field_importance": {
    "content.target_declaration_uuid": "critical",
    "content.revocation_type": "critical",
    "content.retroactive_effect.enabled": "critical",
    "content.retroactive_effect.void_actions_after": "critical",
    "content.cascade_revoke.enabled": "critical"
  }
}
```

2. Sign and publish
3. Clients discover revoke and:
   - Mark original declaration as revoked
   - Void all actions taken by subject after breach date
   - Cascade revoke all delegations issued by subject

---

## Client Processing Rules for Schema Evolution

### Processing Unknown Fields

**Rules**:

1. **Parse `schema_version`**: Determine client's supported version vs. declaration version
2. **Check `field_importance`**: For each field in declaration:
   - If field is known → Process normally
   - If field is unknown:
     - Check `field_importance[field_path]`
     - If `critical` → **REJECT** entire declaration
     - If `non-critical` → Skip field, continue processing
     - If not specified → **Default to `critical`** (reject)
3. **Log Unknown Fields**: Record unknown non-critical fields for future compatibility
4. **Partial Processing**: Process declaration with only known fields if all unknown fields are non-critical

**Example Client Implementation**:

```javascript
function processDeclaration(declaration, clientSchemaVersion) {
  const schemaVersion = parseFloat(declaration.schema_version);
  const fieldImportance = declaration.field_importance || {};
  
  // Full support - process all fields
  if (clientSchemaVersion >= schemaVersion) {
    return processFully(declaration);
  }
  
  // Partial support - check for unknown critical fields
  const declarationFields = extractFieldPaths(declaration);
  const knownFields = getKnownFields(clientSchemaVersion, declaration.declaration_type);
  const unknownFields = declarationFields.filter(f => !knownFields.includes(f));
  
  const unknownCriticalFields = [];
  for (const fieldPath of unknownFields) {
    const importance = fieldImportance[fieldPath] || 'critical'; // Default to critical
    if (importance === 'critical') {
      unknownCriticalFields.push(fieldPath);
    }
  }
  
  if (unknownCriticalFields.length > 0) {
    console.warn(`Rejecting declaration ${declaration.declaration_id}: unknown critical fields:`, unknownCriticalFields);
    return {
      accepted: false,
      reason: `Unknown critical fields in schema ${declaration.schema_version}: ${unknownCriticalFields.join(', ')}`,
      unknownCriticalFields
    };
  }
  
  // Process with known fields only
  console.info(`Processing declaration ${declaration.declaration_id} with partial support. Unknown non-critical fields:`, 
    unknownFields.filter(f => fieldImportance[f] === 'non-critical'));
  
  return processPartially(declaration, knownFields);
}

function extractFieldPaths(obj, prefix = '') {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      paths.push(...extractFieldPaths(value, currentPath));
    } else {
      paths.push(currentPath);
    }
  }
  return paths;
}
```

### Schema Version Support Matrix

**Client Version 1.0**:
- Supports schema versions: `1.0`
- Rejects: Any version > `1.0` with unknown critical fields

**Client Version 1.1** (Future):
- Supports schema versions: `1.0`, `1.1`
- Rejects: Version `2.0` with unknown critical fields
- Processes: Version `1.1` with new non-critical fields

**Migration Path**:
- New schema versions should mark new fields as `non-critical` initially
- Gradually promote to `critical` in later versions
- Always provide `field_importance` mapping for new fields

---

## Future Extensibility

### Schema Evolution

- **Version 1.0** (Current): Base schema with all declaration types
- **Version 1.1** (Future): Add new non-critical fields to existing types
- **Version 1.2** (Future): Promote some non-critical fields to critical
- **Version 2.0** (Future): Introduce new declaration types (e.g., `forum-moderator-delegation`, `message-encryption-key-rotation`)
- **Backward Compatibility**: Clients must support all schema versions they encounter, using `field_importance` to handle unknown fields

### New Declaration Types (Future)

- `forum-moderator-delegation`: Delegate forum-specific moderation
- `message-encryption-key-rotation`: Rotate encryption keys for messaging
- `group-membership-grant`: Grant access to private groups
- `content-moderator-delegation`: Delegate content moderation powers

### Field Importance Guidelines

**Critical Fields** (must be understood):
- Core identification: `declaration_type`, `declaration_id`, `subject`, `issuer`
- Validity: `validity.valid_from`, `validity.valid_until`
- Action type: `content.action_type`, `content.update_type`, `content.revocation_type`
- Trust/permissions: `content.trust_level`, `content.permissions.*`
- Security: `content.retroactive_effect.enabled`, `content.required_countersignatures`

**Non-Critical Fields** (can be ignored):
- Metadata: `metadata.reason`, `metadata.notes`
- Performance hints: `content.max_update_frequency`, `content.max_delegation_duration`
- UI hints: `content.metadata.color`, `content.metadata.icon`
- Future extensions: Any new fields added in minor versions

---

## Update and Revocation Processing

### Declaration Update Chain

When a declaration is updated:

1. **Original Declaration**: `declaration_uuid: "550e8400..."`
2. **Update Declaration**: `declaration_uuid: "770e8400..."`, `original_declaration_uuid: "550e8400..."`, `is_update: 1`
3. **Client Processing**:
   - Load original declaration
   - Apply changes from update declaration
   - Store merged result or track update chain
   - Mark original as superseded (but don't delete)

### Revocation Processing

When a declaration is revoked:

1. **Revoke Declaration**: `declaration_uuid: "880e8400..."`, `target_declaration_uuid: "550e8400..."`
2. **Client Processing**:
   - Mark target declaration as `is_revoked: 1`
   - Set `revoked_at` timestamp
   - If `retroactive_effect.enabled`:
     - Void all actions taken by subject after `retroactive_effective_from`
     - If `cascade_revoke.enabled`:
       - Revoke all delegations issued by subject
       - Revoke all privileges granted by subject
   - Remove from active trust/permission lists

### Update Chain Resolution

Clients should maintain an update chain:

```javascript
function getEffectiveDeclaration(declarationUuid) {
  const original = loadDeclaration(declarationUuid);
  if (!original) return null;
  
  // Check for updates
  const updates = loadUpdatesForDeclaration(declarationUuid);
  if (updates.length === 0) return original;
  
  // Check for revocations
  const revocations = loadRevocationsForDeclaration(declarationUuid);
  const activeRevocation = revocations.find(r => 
    r.content.revocation_type === 'immediate' ||
    (r.content.revocation_type === 'future' && r.content.effective_from <= Date.now() / 1000) ||
    (r.content.revocation_type === 'retroactive' && r.content.retroactive_effect.enabled)
  );
  
  if (activeRevocation) {
    if (activeRevocation.content.retroactive_effect.enabled) {
      return {
        ...original,
        is_revoked: true,
        revoked_at: activeRevocation.issued_at,
        retroactive_void_after: activeRevocation.content.retroactive_effect.void_actions_after
      };
    }
    return {
      ...original,
      is_revoked: true,
      revoked_at: activeRevocation.issued_at
    };
  }
  
  // Apply updates in order
  let effective = original;
  for (const update of updates.sort((a, b) => a.issued_at - b.issued_at)) {
    effective = applyUpdate(effective, update);
  }
  
  return effective;
}
```

---

## Implementation Checklist

- [ ] Create database migration for updated `admindeclarations` table
- [ ] Implement JSON schema validation for `content_json`
- [ ] Implement `field_importance` validation and processing
- [ ] Implement backward compatibility logic (critical/non-critical field handling)
- [ ] Implement Nostr event publishing (kind 31106)
- [ ] Implement Nostr event discovery and verification
- [ ] Implement countersignature collection and validation
- [ ] Implement declaration update/revoke processing
- [ ] Implement update chain resolution
- [ ] Implement retroactive effect processing
- [ ] Implement cascade revoke logic
- [ ] Implement declaration application logic (trust/permissions)
- [ ] Add UI for creating declarations
- [ ] Add UI for updating declarations
- [ ] Add UI for revoking declarations
- [ ] Add UI for viewing discovered declarations
- [ ] Add UI for viewing update chains
- [ ] Add UI for countersigning declarations
- [ ] Add tests for schema validation
- [ ] Add tests for backward compatibility
- [ ] Add tests for update/revoke processing
- [ ] Add tests for retroactive effects
- [ ] Add tests for Nostr publishing/discovery
- [ ] Add tests for countersignature flow
- [ ] Document API endpoints for declaration management

---

## Summary

This plan provides:

1. **Versioned JSON Schema**: Comprehensive schema for all declaration types with examples
2. **Database Updates**: Fields for Nostr publishing, countersignatures, and network discovery
3. **Nostr Integration**: Event structure and publishing strategy
4. **Extensibility**: Framework for future declaration types and schema evolution
5. **Use Cases**: Complete examples for all major scenarios

The schema is designed to naturally extend to future goals including forum moderation, messaging controls, and group management, while maintaining backward compatibility through versioning.

