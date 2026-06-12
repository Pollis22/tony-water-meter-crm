// Single source of truth for Team EJP branding.
// Sampled from the official Team EJP logo: brand blue #067ECC.
export const BRAND = {
  company: 'Team EJP',
  appName: 'Territory CRM',
  tagline: 'Sales Territory CRM',
  region: 'EJP Sales · Michigan East',
  rep: 'Tony Robertson · East MI',
  // Colors
  blue: '#067ECC',
  blueDark: '#0566A8',   // hover / pressed
  blueText: '#067ECC',
  // Logo assets (in client/public/brand)
  logo: '/brand/ejp-logo.png',         // blue wordmark, transparent — for light surfaces
  logoWhite: '/brand/ejp-logo-white.png', // white wordmark — for dark surfaces
} as const;
