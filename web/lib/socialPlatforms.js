// Single source of truth for Social Media platforms + their character caps.
// X enforces 280; Facebook is effectively long-form; LinkedIn org posts cap ~3000;
// Instagram captions cap at 2200.
export const PLATFORM_CAP = { x: 280, facebook: 63206, linkedin: 3000, instagram: 2200 };
export const PLATFORMS = ['x', 'facebook', 'linkedin', 'instagram'];
export const capFor = (p) => PLATFORM_CAP[p] ?? 280;
export const normalizePlatform = (p, fallback = 'x') => (PLATFORMS.includes(p) ? p : fallback);
