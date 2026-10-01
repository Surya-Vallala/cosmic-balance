// Cosmic Khaata theme: deep space, starlight, and one warm star for actions.
// Minimal by intent: flat surfaces, hairline edges, a sparse starfield in
// two places only (welcome and home), and an orbit motif for the logo and
// group badges.

export const colors = {
  space: '#0B0E24', // app background: blue-violet night, not neutral black
  surface: '#13173A', // lists and panels
  raised: '#1C2149', // inputs, pressed rows, segmented track
  line: '#272D5C', // hairlines and outlines
  text: '#ECEDF8', // starlight
  textSoft: '#B5B9DA',
  muted: '#7E83AC',
  placeholder: '#565C8C',
  star: '#F2C46D', // the one accent: primary actions, logo
  starSoft: 'rgba(242, 196, 109, 0.12)',
  onStar: '#0B0E24',
  owed: '#6FE0BF', // aurora green: money coming to you
  owedSoft: 'rgba(111, 224, 191, 0.12)',
  owe: '#FF8C9E', // red-giant rose: money you owe
  oweSoft: 'rgba(255, 140, 158, 0.12)',
};

export const fonts = {
  light: 'Sora_300Light', // big figures and headlines
  medium: 'Sora_600SemiBold', // titles, amounts, buttons
  bold: 'Sora_700Bold', // wordmark
};

// Planet tints for avatars and group badges, picked from the first letter
// of the name so people with different initials get different colours.
const tints = [
  '#4F6FD6', '#8E66CC', '#1F9C80', '#C47C38', '#B84F8A', '#3D95B8',
  '#7F8D2E', '#A6720F', '#5F7BA6', '#17989F', '#704DC9',
];

export function tintFor(name: string): string {
  const c = name.trim().toUpperCase().charCodeAt(0) || 0;
  return tints[c % tints.length];
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 14, lg: 18 };
