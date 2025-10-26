/**
 * Theme Configuration
 * 
 * This file contains all theme definitions and the default theme setting.
 * To change the default theme, simply modify the DEFAULT_THEME constant below.
 */

export type ThemeName = 'light' | 'dark' | 'onyx' | 'ash';
export type TextSize = 'small' | 'medium' | 'large' | 'xlarge';

export interface ThemeColors {
  // Background colors
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  
  // Text colors
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  
  // Border colors
  borderPrimary: string;
  borderSecondary: string;
  
  // Accent colors
  accentPrimary: string;
  accentHover: string;
  
  // Button colors
  buttonBg: string;
  buttonText: string;
  buttonHoverBg: string;
  
  // Special states
  selectedBg: string;
  selectedText: string;
  disabledText: string;
  
  // Status colors
  successColor: string;
  warningColor: string;
  errorColor: string;
  
  // Modal colors
  modalBg: string;
  modalOverlay: string;
  modalBorder: string;
  
  // Scrollbar colors
  scrollbarTrack: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
}

export interface TextSizeConfig {
  baseFontSize: string;
  smallFontSize: string;
  mediumFontSize: string;
  largeFontSize: string;
  inputPadding: string;
  buttonPadding: string;
}

/**
 * DEFAULT THEME
 * Change this constant to set the application's default theme
 * Options: 'light' | 'dark' | 'onyx' | 'ash'
 */
export const DEFAULT_THEME: ThemeName = 'light';

/**
 * DEFAULT TEXT SIZE
 * Change this constant to set the application's default text size
 * Options: 'small' | 'medium' | 'large' | 'xlarge'
 */
export const DEFAULT_TEXT_SIZE: TextSize = 'medium';

/**
 * Theme Definitions
 */
export const THEMES: Record<ThemeName, ThemeColors> = {
  light: {
    bgPrimary: '#ffffff',
    bgSecondary: '#fafafa',
    bgTertiary: '#f3f4f6',
    bgHover: '#f9fafb',
    
    textPrimary: '#111827',
    textSecondary: '#374151',
    textTertiary: '#6b7280',
    
    borderPrimary: '#e5e7eb',
    borderSecondary: '#d1d5db',
    
    accentPrimary: '#3b82f6',
    accentHover: '#2563eb',
    
    buttonBg: '#f3f4f6',
    buttonText: '#111827',
    buttonHoverBg: '#e5e7eb',
    
    selectedBg: '#dbeafe',
    selectedText: '#1e40af',
    disabledText: '#9ca3af',
    
    successColor: '#10b981',
    warningColor: '#f59e0b',
    errorColor: '#ef4444',
    
    modalBg: '#ffffff',
    modalOverlay: 'rgba(0, 0, 0, 0.4)',
    modalBorder: '#d1d5db',
    
    scrollbarTrack: '#f3f4f6',
    scrollbarThumb: '#d1d5db',
    scrollbarThumbHover: '#9ca3af',
  },
  
  dark: {
    bgPrimary: '#36393f',
    bgSecondary: '#2f3136',
    bgTertiary: '#202225',
    bgHover: '#3c3f45',
    
    textPrimary: '#dcddde',
    textSecondary: '#b9bbbe',
    textTertiary: '#8e9297',
    
    borderPrimary: '#202225',
    borderSecondary: '#2f3136',
    
    accentPrimary: '#5865f2',
    accentHover: '#4752c4',
    
    buttonBg: '#4f545c',
    buttonText: '#ffffff',
    buttonHoverBg: '#5d6269',
    
    selectedBg: '#404449',
    selectedText: '#ffffff',
    disabledText: '#72767d',
    
    successColor: '#3ba55d',
    warningColor: '#faa81a',
    errorColor: '#ed4245',
    
    modalBg: '#36393f',
    modalOverlay: 'rgba(0, 0, 0, 0.7)',
    modalBorder: '#1a1c1e',
    
    scrollbarTrack: '#2f3136',
    scrollbarThumb: '#1a1c1e',
    scrollbarThumbHover: '#3a3d42',
  },
  
  onyx: {
    // Black and gray with white text
    bgPrimary: '#000000',
    bgSecondary: '#1a1a1a',
    bgTertiary: '#0a0a0a',
    bgHover: '#2a2a2a',
    
    textPrimary: '#ffffff',
    textSecondary: '#e0e0e0',
    textTertiary: '#a0a0a0',
    
    borderPrimary: '#333333',
    borderSecondary: '#444444',
    
    accentPrimary: '#00a8ff',
    accentHover: '#0088cc',
    
    buttonBg: '#2a2a2a',
    buttonText: '#ffffff',
    buttonHoverBg: '#3a3a3a',
    
    selectedBg: '#1a3a5a',
    selectedText: '#ffffff',
    disabledText: '#666666',
    
    successColor: '#00d26a',
    warningColor: '#ffaa00',
    errorColor: '#ff4444',
    
    modalBg: '#000000',
    modalOverlay: 'rgba(0, 0, 0, 0.85)',
    modalBorder: '#444444',
    
    scrollbarTrack: '#0a0a0a',
    scrollbarThumb: '#1a1a1a',
    scrollbarThumbHover: '#2a2a2a',
  },
  
  ash: {
    // Mid-gray with white text
    bgPrimary: '#4a4a4a',
    bgSecondary: '#3a3a3a',
    bgTertiary: '#2a2a2a',
    bgHover: '#555555',
    
    textPrimary: '#ffffff',
    textSecondary: '#e8e8e8',
    textTertiary: '#b0b0b0',
    
    borderPrimary: '#5a5a5a',
    borderSecondary: '#6a6a6a',
    
    accentPrimary: '#60a5fa',
    accentHover: '#3b82f6',
    
    buttonBg: '#5a5a5a',
    buttonText: '#ffffff',
    buttonHoverBg: '#6a6a6a',
    
    selectedBg: '#2563eb',
    selectedText: '#ffffff',
    disabledText: '#808080',
    
    successColor: '#34d399',
    warningColor: '#fbbf24',
    errorColor: '#f87171',
    
    modalBg: '#4a4a4a',
    modalOverlay: 'rgba(0, 0, 0, 0.6)',
    modalBorder: '#2a2a2a',
    
    scrollbarTrack: '#3a3a3a',
    scrollbarThumb: '#2a2a2a',
    scrollbarThumbHover: '#555555',
  },
};

/**
 * Text Size Configurations
 */
export const TEXT_SIZES: Record<TextSize, TextSizeConfig> = {
  small: {
    baseFontSize: '13px',
    smallFontSize: '11px',
    mediumFontSize: '13px',
    largeFontSize: '15px',
    inputPadding: '4px 6px',
    buttonPadding: '4px 8px',
  },
  medium: {
    baseFontSize: '14px',
    smallFontSize: '12px',
    mediumFontSize: '14px',
    largeFontSize: '16px',
    inputPadding: '6px 8px',
    buttonPadding: '6px 10px',
  },
  large: {
    baseFontSize: '16px',
    smallFontSize: '14px',
    mediumFontSize: '16px',
    largeFontSize: '18px',
    inputPadding: '8px 10px',
    buttonPadding: '8px 12px',
  },
  xlarge: {
    baseFontSize: '18px',
    smallFontSize: '16px',
    mediumFontSize: '18px',
    largeFontSize: '20px',
    inputPadding: '10px 12px',
    buttonPadding: '10px 14px',
  },
};

/**
 * Apply a theme to the document root
 */
export function applyTheme(themeName: ThemeName): void {
  const theme = THEMES[themeName];
  const root = document.documentElement;
  
  Object.entries(theme).forEach(([key, value]) => {
    root.style.setProperty(`--${camelToKebab(key)}`, value);
  });
  
  // Store current theme as data attribute for potential CSS selectors
  root.setAttribute('data-theme', themeName);
}

/**
 * Apply text size to the document root
 */
export function applyTextSize(size: TextSize): void {
  const config = TEXT_SIZES[size];
  const root = document.documentElement;
  
  Object.entries(config).forEach(([key, value]) => {
    root.style.setProperty(`--${camelToKebab(key)}`, value);
  });
  
  // Store current text size as data attribute
  root.setAttribute('data-text-size', size);
}

/**
 * Convert camelCase to kebab-case
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Get theme display name
 */
export function getThemeDisplayName(theme: ThemeName): string {
  const names: Record<ThemeName, string> = {
    light: 'Light Theme',
    dark: 'Dark',
    onyx: 'Onyx (Black & Gray)',
    ash: 'Ash (Mid-Gray)',
  };
  return names[theme];
}

/**
 * Get text size display name
 */
export function getTextSizeDisplayName(size: TextSize): string {
  const names: Record<TextSize, string> = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    xlarge: 'Extra Large',
  };
  return names[size];
}

