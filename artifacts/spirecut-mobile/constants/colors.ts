/**
 * Spirecut brand colors — derived from artifacts/spirecut-patient/src/index.css
 * Primary red: hsl(353 78% 45%) = #C41230
 * Foreground charcoal: hsl(220 20% 12%) = #181B24
 * Border: hsl(220 13% 88%) = #DADDE5
 * Muted: hsl(220 14% 96%) = #F3F4F6
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#181B24',
    tint: '#C41230',

    // Core surfaces
    background: '#FFFFFF',
    foreground: '#181B24',
    heroBackground: '#FFF5F6',

    // Cards
    card: '#FFFFFF',
    cardForeground: '#181B24',

    // Primary = Spirecut red
    primary: '#C41230',
    primaryForeground: '#FFFFFF',

    // Secondary = charcoal
    secondary: '#181B24',
    secondaryForeground: '#FFFFFF',

    // Muted
    muted: '#F3F4F6',
    mutedForeground: '#6B7280',

    // Accent
    accent: '#F3F4F6',
    accentForeground: '#181B24',

    // Destructive
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',

    // Borders
    border: '#DADDE5',
    input: '#DADDE5',
  },

  radius: 6,
};

export default colors;
