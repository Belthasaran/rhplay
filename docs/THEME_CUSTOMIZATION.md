# Theme and Text Size Customization

## Overview

RHTools now includes a comprehensive theming system that allows users to customize the appearance of the application through the Settings panel. Users can choose from multiple color schemes and adjust text size to their preference.

## Features

### Theme Options

The application includes 4 built-in themes:

1. **Light Theme** (default)
   - Clean, bright interface with white backgrounds
   - Best for well-lit environments
   - Traditional application appearance

2. **Dark**
   - Dark gray backgrounds (#36393f, #2f3136, #202225)
   - Reduced eye strain in low-light conditions
   - Purple accent colors (#5865f2)
   - Darker scrollbars (#1a1c1e) that blend seamlessly with the UI

3. **Onyx (Black & Gray)**
   - High contrast black and gray color scheme
   - Pure black backgrounds (#000000)
   - White text for maximum contrast
   - Ideal for OLED displays and dark environments
   - Nearly invisible scrollbars (#1a1a1a) for a clean, minimalist look

4. **Ash (Mid-Gray)**
   - Balanced mid-gray theme
   - Gray backgrounds (#4a4a4a, #3a3a3a)
   - White text with good readability
   - Comfortable for extended use
   - Subtle darker scrollbars (#2a2a2a) that blend with the interface

### Text Size Options

Users can adjust the application's text size with 4 options:

1. **Small** - 13px base font size
2. **Medium** (default) - 14px base font size
3. **Large** - 16px base font size
4. **Extra Large** - 18px base font size

Text size affects:
- Base font size throughout the application
- Input field and button padding (proportionally adjusted)
- All UI elements scale appropriately

### Visual Enhancements

**Custom Scrollbars**
- Scrollbars automatically adapt to each theme
- Dark themes feature darker scrollbars that blend seamlessly with the UI
- Light theme uses subtle gray scrollbars
- Smooth hover effects for better visual feedback

**Modal Dialog Borders**
- All modal dialogs now have solid contrasting borders
- Borders help clearly define dialog boundaries
- Border colors automatically adjust based on the selected theme
- Provides better visual separation from the backdrop overlay

## Usage

### Accessing Theme Settings

1. Click the "Open Settings" button in the toolbar
2. The Theme setting appears as the **first option** in the Settings panel
3. The Text Size setting appears immediately below the Theme setting

### Changing Theme

1. Open Settings
2. Select your preferred theme from the dropdown:
   - Light Theme
   - Dark
   - Onyx (Black & Gray)
   - Ash (Mid-Gray)
3. **Theme applies immediately** - no need to save or restart
4. Click "Save Changes" to persist your choice

### Adjusting Text Size

1. Open Settings
2. Use the slider control below the Theme setting
3. Drag the slider to choose from 4 size options
4. Current size displays to the right of the slider
5. **Size applies immediately** - see changes in real-time
6. Click "Save Changes" to persist your choice

## For Developers

### Changing the Default Theme

To change the default theme that applies when a user hasn't selected a custom theme:

1. Open `electron/renderer/src/themeConfig.ts`
2. Locate the `DEFAULT_THEME` constant (around line 70)
3. Change the value to one of: `'light'`, `'dark'`, `'onyx'`, or `'ash'`

```typescript
/**
 * DEFAULT THEME
 * Change this constant to set the application's default theme
 * Options: 'light' | 'dark' | 'onyx' | 'ash'
 */
export const DEFAULT_THEME: ThemeName = 'dark';  // Changed to dark theme
```

### Changing the Default Text Size

To change the default text size:

1. Open `electron/renderer/src/themeConfig.ts`
2. Locate the `DEFAULT_TEXT_SIZE` constant (around line 77)
3. Change the value to one of: `'small'`, `'medium'`, `'large'`, or `'xlarge'`

```typescript
/**
 * DEFAULT TEXT SIZE
 * Change this constant to set the application's default text size
 * Options: 'small' | 'medium' | 'large' | 'xlarge'
 */
export const DEFAULT_TEXT_SIZE: TextSize = 'large';  // Changed to large
```

### Architecture

The theming system uses:

1. **CSS Custom Properties (CSS Variables)**
   - All colors and sizes defined as CSS variables in `:root`
   - Variables dynamically updated when theme changes
   - Enables real-time theme switching without page reload

2. **Centralized Configuration**
   - `themeConfig.ts` contains all theme definitions
   - Easy to add new themes or modify existing ones
   - Type-safe theme and text size types

3. **Persistent Storage**
   - Theme and text size preferences saved to `csettings` database table
   - Settings persist across application restarts
   - Loaded and applied on application startup

### Adding a New Theme

To add a new theme:

1. Open `electron/renderer/src/themeConfig.ts`
2. Add your theme name to the `ThemeName` type:
   ```typescript
   export type ThemeName = 'light' | 'dark' | 'onyx' | 'ash' | 'custom';
   ```

3. Add theme colors to the `THEMES` object:
   ```typescript
   custom: {
     bgPrimary: '#yourcolor',
     bgSecondary: '#yourcolor',
     // ... etc
   }
   ```

4. Update `getThemeDisplayName()` function to include the new theme name

5. Add option to Settings dropdown in `App.vue`:
   ```html
   <option value="custom">Custom Theme</option>
   ```

### CSS Variables Reference

Key CSS variables available for styling:

**Colors:**
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary` - Background colors
- `--text-primary`, `--text-secondary`, `--text-tertiary` - Text colors
- `--border-primary`, `--border-secondary` - Border colors
- `--accent-primary`, `--accent-hover` - Accent/link colors
- `--success-color`, `--warning-color`, `--error-color` - Status colors
- `--modal-bg`, `--modal-overlay`, `--modal-border` - Modal appearance
- `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover` - Scrollbar colors

**Sizes:**
- `--base-font-size` - Base font size
- `--small-font-size`, `--medium-font-size`, `--large-font-size` - Font size variants
- `--input-padding`, `--button-padding` - Control padding

## Technical Implementation

### Files Modified

- `electron/renderer/src/App.vue`
  - Added theme and textSize to settings object
  - Added Theme and Text Size UI controls
  - Updated CSS to use CSS custom properties
  - Added theme application logic
  - Updated save/load settings functions

### Files Created

- `electron/renderer/src/themeConfig.ts`
  - Theme definitions and constants
  - Text size configurations
  - Theme application functions
  - Type definitions

### Database Storage

Theme and text size settings are stored in the `csettings` table:

- `csetting_name = 'theme'`, `csetting_value = 'dark'`
- `csetting_name = 'textSize'`, `csetting_value = 'medium'`

## Benefits

1. **Accessibility** - Multiple themes and text sizes accommodate different visual preferences and needs
2. **User Comfort** - Users can choose themes optimized for their environment (bright/dark)
3. **Customization** - Personalize the application appearance
4. **Developer-Friendly** - Easy to add new themes or modify existing ones
5. **Performance** - CSS variables enable instant theme switching without re-rendering
6. **Visual Clarity** - Modal borders and custom scrollbars provide clear visual boundaries and better UI definition

## Future Enhancements

Possible future improvements:
- Custom color picker for creating user-defined themes
- Import/export theme configurations
- Per-panel theme overrides
- Time-based theme switching (auto dark mode at night)
- High contrast mode for accessibility

