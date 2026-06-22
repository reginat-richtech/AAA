// Single source of truth for Social Media platforms + their character caps.
// X enforces 280; Facebook is effectively long-form; LinkedIn org posts cap ~3000;
// Instagram captions cap at 2200.
export const PLATFORM_CAP = { x: 280, facebook: 63206, linkedin: 3000, instagram: 2200 };
export const PLATFORMS = ['x', 'facebook', 'linkedin', 'instagram'];
export const PLATFORM_LABEL = { x: 'X', facebook: 'Facebook', linkedin: 'LinkedIn', instagram: 'Instagram' };
export const capFor = (p) => PLATFORM_CAP[p] ?? 280;
export const normalizePlatform = (p, fallback = 'x') => (PLATFORMS.includes(p) ? p : fallback);

// What each platform's publisher can actually post (so we reject up front, not at publish).
export const PLATFORM_MEDIA = {
  x:         { video: true,  maxImages: 4,  requiresMedia: false },
  facebook:  { video: true,  maxImages: 10, requiresMedia: false },
  linkedin:  { video: false, maxImages: 9,  requiresMedia: false },
  instagram: { video: false, maxImages: 10, requiresMedia: true  },
};

// Image types we accept on upload. PNG/WebP/HEIC are fine because the public
// media route auto-converts them to JPEG before a platform fetches them.
export const ACCEPTED_IMAGE = /^image\/(jpe?g|png|gif|webp|heic|heif)$/i;
export const ACCEPTED_VIDEO = /^video\/(mp4|quicktime)$/i;

// Validate a post against its platform's rules. Used server-side as the submit
// gate AND client-side for live feedback. `media` = [{ kind, content_type }].
// Returns { ok, errors: string[] }.
export function validateSocialPost({ platform, content = '', media = [] } = {}) {
  const p = normalizePlatform(platform);
  const rules = PLATFORM_MEDIA[p] || PLATFORM_MEDIA.x;
  const label = PLATFORM_LABEL[p] || p;
  const list = Array.isArray(media) ? media : [];
  const images = list.filter((m) => m && m.kind === 'image');
  const videos = list.filter((m) => m && m.kind === 'video');
  const errors = [];

  if (String(content || '').length > capFor(p)) {
    errors.push(`Text is over the ${capFor(p)}-character limit for ${label}.`);
  }
  if (rules.requiresMedia && list.length === 0) {
    errors.push(`${label} requires at least one image.`);
  }
  if (!rules.requiresMedia && !String(content || '').trim() && list.length === 0) {
    errors.push('Add some text or media before submitting.');
  }
  if (videos.length && !rules.video) {
    errors.push(`${label} can't post video yet — use an image instead.`);
  }
  if (images.length > rules.maxImages) {
    errors.push(`Too many images for ${label} (max ${rules.maxImages}).`);
  }
  for (const m of list) {
    const ct = (m && m.content_type) || '';
    if (m.kind === 'image' && !ACCEPTED_IMAGE.test(ct)) errors.push(`Unsupported image format: ${ct || 'unknown'}.`);
    if (m.kind === 'video' && !ACCEPTED_VIDEO.test(ct)) errors.push(`Unsupported video format: ${ct || 'unknown'}.`);
  }
  return { ok: errors.length === 0, errors };
}
