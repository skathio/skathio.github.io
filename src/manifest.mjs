// The homepage manifest a project repo carries at .github/homepage.json, and its validation.
// Manifests come from other repositories, so everything here treats them as untrusted data:
// each field is checked against a closed shape, and anything that reaches HTML or CSS is
// constrained here before render.mjs escapes it again.

export const MANIFEST_PATH = '.github/homepage.json';

export const LIMITS = Object.freeze({
  name: 40,
  tagline: 160,
  kind: 24,
  tags: 5,
  tag: 20,
  links: 4,
  linkLabel: 24,
  imageBytes: 512 * 1024,
  // An SVG is inlined into index.html as base64, so it gets a tighter cap than a raster file.
  svgBytes: 64 * 1024,
});

export const DEFAULT_COLOUR = '#5b606b';

const HEX = /^#[0-9a-f]{6}$/i;
const KNOWN = new Set(['name', 'tagline', 'kind', 'tags', 'colour', 'image', 'links', 'listed']);

// Extension → media type. SVG is allowed, screened (see screenSvg), and never served as a file.
export const IMAGE_TYPES = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
});

export const isHexColour = (v) => typeof v === 'string' && HEX.test(v);

const extOf = (p) => {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? m[1].toLowerCase() : '';
};

// An https URL, or null. Only https: no javascript:, data: or plain http links reach the page.
export function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return u.href;
}

// A path inside the repository: relative, no `..`, a plain character set, a known image extension.
export function repoImagePath(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null;
  if (value.startsWith('/') || value.split('/').some((s) => s === '..' || s === '' || s === '.')) return null;
  return IMAGE_TYPES[extOf(value)] ? value : null;
}

// The branding image: either a repo path or an https URL. Returns { kind, ref } or null.
export function parseImage(value) {
  if (typeof value !== 'string') return null;
  if (/^https:\/\//i.test(value)) {
    const url = httpsUrl(value);
    return url ? { kind: 'url', ref: url } : null;
  }
  const p = repoImagePath(value);
  return p ? { kind: 'path', ref: p } : null;
}

const text = (v, max) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= max ? t : null;
};

// Validates a parsed manifest. Returns { manifest, errors }: manifest holds only the fields
// that passed, so a manifest with one bad field still yields a usable tile.
export function validateManifest(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { manifest: null, errors: ['the manifest is not a JSON object'] };
  }
  for (const key of Object.keys(raw)) if (!KNOWN.has(key)) errors.push(`unknown field "${key}"`);

  const m = {};
  if ('name' in raw) {
    const v = text(raw.name, LIMITS.name);
    v ? (m.name = v) : errors.push(`name must be a non-empty string of at most ${LIMITS.name} characters`);
  }
  if ('tagline' in raw) {
    const v = text(raw.tagline, LIMITS.tagline);
    v ? (m.tagline = v) : errors.push(`tagline must be a non-empty string of at most ${LIMITS.tagline} characters`);
  }
  if ('kind' in raw) {
    const v = text(raw.kind, LIMITS.kind);
    v ? (m.kind = v) : errors.push(`kind must be a non-empty string of at most ${LIMITS.kind} characters`);
  }
  if ('tags' in raw) {
    if (!Array.isArray(raw.tags)) {
      errors.push('tags must be a list of short strings');
    } else {
      const tags = [];
      for (const t of raw.tags) {
        const v = text(t, LIMITS.tag);
        if (!v) { errors.push(`each tag must be a non-empty string of at most ${LIMITS.tag} characters`); continue; }
        if (tags.includes(v)) continue;
        if (tags.length >= LIMITS.tags) { errors.push(`at most ${LIMITS.tags} tags`); break; }
        tags.push(v);
      }
      m.tags = tags;
    }
  }
  if ('colour' in raw) {
    isHexColour(raw.colour) ? (m.colour = raw.colour.toLowerCase()) : errors.push('colour must be a hex colour like #b80f0f');
  }
  if ('image' in raw) {
    const v = parseImage(raw.image);
    v ? (m.image = v) : errors.push('image must be a repo-relative path to a .png, .jpg, .webp or .svg file, or an https URL');
  }
  if ('links' in raw) {
    const links = [];
    if (!raw.links || typeof raw.links !== 'object' || Array.isArray(raw.links)) {
      errors.push('links must be an object of label → https URL');
    } else {
      for (const [label, url] of Object.entries(raw.links)) {
        const l = text(label, LIMITS.linkLabel);
        const u = httpsUrl(url);
        if (!l || !u) { errors.push(`link "${String(label).slice(0, 40)}" needs a short label and an https URL`); continue; }
        if (links.length >= LIMITS.links) { errors.push(`at most ${LIMITS.links} links`); break; }
        links.push({ label: l, url: u });
      }
    }
    m.links = links;
  }
  if ('listed' in raw) {
    typeof raw.listed === 'boolean' ? (m.listed = raw.listed) : errors.push('listed must be true or false');
  }
  return { manifest: m, errors };
}

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

// SVG is the one format that can carry script. The real defence is that an SVG is never served
// from this origin: collect.mjs inlines it into the page as a data: URI inside <img>, where SVG
// script never runs. This screen is the second layer: it refuses, rather than sanitises, an SVG
// with script, handlers, animation, external references, embedded HTML, entities or character
// references, and any namespace-prefixed element (a prefix can smuggle <script> past a name check).
const SVG_BANNED = [
  [/<script/, '<script>'],
  [/<[a-z][\w.-]*:[\w.-]/, 'a namespace-prefixed element'],
  [/\son[a-z]+\s*=/, 'an event handler'],
  [/javascript:/, 'a javascript: URL'],
  [/&#/, 'a character reference'],
  [/<!(?:entity|doctype)/, 'a DTD or entity'],
  [/<(?:foreignobject|iframe|embed|object|set|animate|animatemotion|animatetransform|handler|listener)[\s>/]/, 'an element that embeds content or animates attributes'],
  [/(?:href|src)\s*=\s*["']\s*(?!#)/, 'an external reference'],
  [/url\(\s*["']?\s*(?!#)/, 'an external url()'],
  [/@import/, 'a stylesheet import'],
  [/\\/, 'a backslash escape'],
];
export function screenSvg(source) {
  const s = source.toLowerCase();
  if (!/<svg[\s>]/.test(s)) return 'not an SVG document';
  for (const [re, what] of SVG_BANNED) if (re.test(s)) return `the SVG contains ${what}`;
  return null;
}

// Checks fetched image bytes against the declared extension's real format. Returns an error or null.
export function checkImageBytes(buf, ext) {
  if (buf.length === 0) return 'the image is empty';
  if (buf.length > LIMITS.imageBytes) return `the image is ${buf.length} bytes; the limit is ${LIMITS.imageBytes}`;
  switch (ext) {
    case 'png': return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]) ? null : 'not a PNG file';
    case 'jpg':
    case 'jpeg': return startsWith(buf, [0xff, 0xd8, 0xff]) ? null : 'not a JPEG file';
    case 'webp': return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.subarray(8, 12).toString('latin1') === 'WEBP' ? null : 'not a WebP file';
    case 'svg': return buf.length > LIMITS.svgBytes ? `the SVG is ${buf.length} bytes; the limit is ${LIMITS.svgBytes}` : screenSvg(buf.toString('utf8'));
    default: return 'unsupported image type';
  }
}

// The extension an image is stored under: from the path, or for a URL from its path or media type.
export function imageExt(image, contentType = '') {
  const fromPath = extOf(image.kind === 'url' ? new URL(image.ref).pathname : image.ref);
  if (IMAGE_TYPES[fromPath]) return fromPath === 'jpeg' ? 'jpg' : fromPath;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  const hit = Object.entries(IMAGE_TYPES).find(([, t]) => t === ct);
  return hit ? (hit[0] === 'jpeg' ? 'jpg' : hit[0]) : null;
}
