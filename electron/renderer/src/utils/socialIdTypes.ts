/**
 * Social ID Types and Verification Tiers
 * 
 * Centralized configuration for social identity types, their verification tiers,
 * and available verification methods.
 */

export interface SocialIdType {
  value: string;
  label: string;
  tier: number;
  placeholder: string;
  verificationMethods: VerificationMethod[];
}

export interface VerificationCodeFormat {
  id: string;
  label: string;
  description: string;
  format: (username: string, npub: string) => string;
  supported: boolean;
}

export interface VerificationMethod {
  id: string;
  label: string;
  description: string;
  supported: boolean;
  clientSideVerifiable: boolean;
  codeFormats?: VerificationCodeFormat[];
  preferredFormatId?: string; // ID of the preferred format
}

/**
 * Social ID Types organized by verification tier
 * 
 * Tier 1-3: High-Level Verify (Challenge Posting supported)
 * Tier 6: Verify Not currently supported
 */
export const SOCIAL_ID_TYPES: SocialIdType[] = [
  // Tier 1 - High-Level Verify (Challenge Posting)
  {
    value: 'twitch',
    label: 'Twitch Username',
    tier: 1,
    placeholder: 'username',
    verificationMethods: [
      {
        id: 'challenge-posting',
        label: 'Challenge Posting',
        description: 'Post a verification code to your Twitch profile bio',
        supported: true,
        clientSideVerifiable: true,
        preferredFormatId: 'markdown-link',
        codeFormats: [
          {
            id: 'markdown-link',
            label: 'Markdown Link (About Section)',
            description: 'Least obtrusive format for Twitch profiles',
            format: (username: string, npub: string) => {
              return `[SMW Player Id](https://m.twitch.tv/${username}/about#${npub})`;
            },
            supported: true
          },
          {
            id: 'plain-link',
            label: 'Plain Link',
            description: 'Direct link format',
            format: (username: string, npub: string) => {
              return `https://m.twitch.tv/${username}/about#${npub}`;
            },
            supported: true
          },
          {
            id: 'nostr-proof',
            label: 'Nostr Proof',
            description: 'Standard nostr-proof format',
            format: (username: string, npub: string) => {
              return `nostr-proof:v1:${npub}`;
            },
            supported: true
          },
          {
            id: 'text-with-npub',
            label: 'Text with npub',
            description: 'Simple text format with npub',
            format: (username: string, npub: string) => {
              return `Nostr-proof ${npub}`;
            },
            supported: true
          }
        ]
      },
      {
        id: 'custom-oracle',
        label: 'Custom Oracle',
        description: 'Use a custom verification oracle service',
        supported: false,
        clientSideVerifiable: false
      },
      {
        id: 'discord-bot',
        label: 'Discord Bot',
        description: 'Verify through Discord bot integration',
        supported: false,
        clientSideVerifiable: false
      }
    ]
  },
  {
    value: 'youtube',
    label: 'YouTube Channel Link',
    tier: 1,
    placeholder: 'https://youtube.com/channel/...',
    verificationMethods: [
      {
        id: 'challenge-posting',
        label: 'Challenge Posting',
        description: 'Post a verification code to your YouTube channel description',
        supported: true,
        clientSideVerifiable: true,
        preferredFormatId: 'nostr-proof',
        codeFormats: [
          {
            id: 'nostr-proof',
            label: 'Nostr Proof (Recommended)',
            description: 'Standard nostr-proof format',
            format: (channelUrl: string, npub: string) => {
              return `nostr-proof:v1:${npub}`;
            },
            supported: true
          },
          {
            id: 'text-with-npub',
            label: 'Text with npub',
            description: 'Simple text format with npub',
            format: (channelUrl: string, npub: string) => {
              return `Nostr-proof ${npub}`;
            },
            supported: true
          },
          {
            id: 'link-with-npub',
            label: 'Link with npub',
            description: 'Link format with npub hash',
            format: (channelUrl: string, npub: string) => {
              // Extract channel ID or username from URL if possible
              const urlMatch = channelUrl.match(/(?:channel\/|@)([^\/\?]+)/);
              const channelId = urlMatch ? urlMatch[1] : 'channel';
              return `https://www.youtube.com/${channelId}/about#${npub}`;
            },
            supported: true
          }
        ]
      },
      {
        id: 'custom-oracle',
        label: 'Custom Oracle',
        description: 'Use a custom verification oracle service',
        supported: false,
        clientSideVerifiable: false
      },
      {
        id: 'discord-bot',
        label: 'Discord Bot',
        description: 'Verify through Discord bot integration',
        supported: false,
        clientSideVerifiable: false
      }
    ]
  },
  
  // Tier 6 - Verify Not currently supported
  {
    value: 'brightid',
    label: 'BrightID',
    tier: 6,
    placeholder: 'BrightID identifier',
    verificationMethods: []
  },
  {
    value: 'discord',
    label: 'Discord Username',
    tier: 6,
    placeholder: 'username#1234',
    verificationMethods: []
  },
  {
    value: 'github',
    label: 'GitHub Username',
    tier: 6,
    placeholder: 'username',
    verificationMethods: []
  },
  {
    value: 'keyoxide',
    label: 'Keyoxide Profile Link or Hash',
    tier: 6,
    placeholder: 'https://keyoxide.org/... or hash',
    verificationMethods: []
  },
  {
    value: 'gamerprofiles',
    label: 'Gamerprofiles',
    tier: 6,
    placeholder: 'Gamerprofiles profile link',
    verificationMethods: []
  },
  {
    value: 'linktree',
    label: 'Linktr.EE',
    tier: 6,
    placeholder: 'https://linktr.ee/username',
    verificationMethods: []
  },
  {
    value: 'playtracker',
    label: 'Playtracker',
    tier: 6,
    placeholder: 'Playtracker profile link',
    verificationMethods: []
  },
  {
    value: 'steam',
    label: 'Steam Name',
    tier: 6,
    placeholder: 'Steam username',
    verificationMethods: []
  },
  {
    value: 'smwcentral',
    label: 'SMWCentral Username',
    tier: 6,
    placeholder: 'SMWCentral username',
    verificationMethods: []
  }
];

/**
 * Get Social ID type by value
 */
export function getSocialIdType(value: string): SocialIdType | undefined {
  return SOCIAL_ID_TYPES.find(type => type.value === value);
}

/**
 * Get all Social ID types for a specific tier
 */
export function getSocialIdTypesByTier(tier: number): SocialIdType[] {
  return SOCIAL_ID_TYPES.filter(type => type.tier === tier);
}

/**
 * Get all Social ID types that support verification (Tier 1-3)
 */
export function getVerifiableSocialIdTypes(): SocialIdType[] {
  return SOCIAL_ID_TYPES.filter(type => type.tier >= 1 && type.tier <= 3);
}

/**
 * Check if a Social ID type is verifiable
 */
export function isVerifiableSocialIdType(value: string): boolean {
  const type = getSocialIdType(value);
  return type ? type.tier >= 1 && type.tier <= 3 : false;
}

/**
 * Get supported verification methods for a Social ID type
 */
export function getSupportedVerificationMethods(value: string): VerificationMethod[] {
  const type = getSocialIdType(value);
  if (!type) return [];
  return type.verificationMethods.filter(method => method.supported);
}

/**
 * Check if profile meets Social ID verification requirements
 * Requires at least one Tier 1, 2, or 3 Social ID
 */
export function meetsSocialIdRequirements(socialIds: Array<{type: string, value: string}>): boolean {
  if (!socialIds || socialIds.length === 0) return false;
  
  return socialIds.some(social => {
    const type = getSocialIdType(social.type);
    return type && type.tier >= 1 && type.tier <= 3 && social.value.trim() !== '';
  });
}

