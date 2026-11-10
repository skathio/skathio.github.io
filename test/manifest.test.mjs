import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, parseImage, httpsUrl, checkImageBytes, screenSvg, imageExt, LIMITS } from '../src/manifest.mjs';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('a full manifest validates with no errors', () => {
  const { manifest, errors } = validateManifest({
    name: 'SoMi', tagline: 'A plugin.', colour: '#B80F0F', image: 'site/brand/icon.png',
    links: { npm: 'https://www.npmjs.com/package/x' }, listed: true,
  });
  assert.deepEqual(errors, []);
  assert.equal(manifest.colour, '#b80f0f');
  assert.deepEqual(manifest.image, { kind: 'path', ref: 'site/brand/icon.png' });
  assert.deepEqual(manifest.links, [{ label: 'npm', url: 'https://www.npmjs.com/package/x' }]);
});

test('every field is optional', () => {
  assert.deepEqual(validateManifest({}), { manifest: {}, errors: [] });
});

test('bad fields are dropped one by one, the good ones kept', () => {
  const { manifest, errors } = validateManifest({ name: 'Ok', colour: 'red;}body{display:none', links: { x: 'javascript:alert(1)', Docs: 'https://e.com' } });
  assert.equal(manifest.name, 'Ok');
  assert.equal(manifest.colour, undefined);
  assert.deepEqual(manifest.links, [{ label: 'Docs', url: 'https://e.com/' }]);
  assert.equal(errors.length, 2);
});

test('a non-object manifest is refused', () => {
  for (const raw of [null, [], 'x', 3]) assert.equal(validateManifest(raw).manifest, null);
});

test('text fields have length limits', () => {
  assert.ok(validateManifest({ name: 'x'.repeat(LIMITS.name + 1) }).errors.length);
  assert.ok(validateManifest({ tagline: '   ' }).errors.length);
});

test('links are capped', () => {
  const links = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`l${i}`, `https://e.com/${i}`]));
  assert.equal(validateManifest({ links }).manifest.links.length, LIMITS.links);
});

test('image paths stay inside the repository', () => {
  for (const bad of ['../x.png', '/etc/x.png', 'a/../b.png', 'a//b.png', './a.png', 'a.gif', 'a b.png', 'a\\b.png', 'x.png?y']) {
    assert.equal(parseImage(bad), null, bad);
  }
  assert.deepEqual(parseImage('public/mark.svg'), { kind: 'path', ref: 'public/mark.svg' });
});

test('image URLs must be https', () => {
  assert.equal(parseImage('http://e.com/a.png'), null);
  assert.equal(parseImage('https://user:pw@e.com/a.png'), null);
  assert.deepEqual(parseImage('https://e.com/a.png'), { kind: 'url', ref: 'https://e.com/a.png' });
  assert.equal(httpsUrl('data:image/png;base64,AAAA'), null);
});

test('image bytes must match their format and size', () => {
  assert.equal(checkImageBytes(PNG, 'png'), null);
  assert.match(checkImageBytes(PNG, 'jpg'), /JPEG/);
  assert.match(checkImageBytes(Buffer.alloc(0), 'png'), /empty/);
  assert.match(checkImageBytes(Buffer.alloc(LIMITS.imageBytes + 1, 0x89), 'png'), /limit/);
  assert.match(checkImageBytes(Buffer.from('<svg>' + ' '.repeat(LIMITS.svgBytes) + '</svg>'), 'svg'), /limit/);
});

test('an SVG with script, handlers or external references is refused', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/><stop offset="0"/><rect fill="url(#bg)"/></svg>';
  assert.equal(screenSvg(ok), null);
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)"/></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><image href="https://tracker.example/x.png"/></svg>',
    '<!DOCTYPE x [<!ENTITY a "b">]><svg></svg>',
    '<html>not svg</html>',
    // A namespace prefix carries <script> past a plain name check.
    '<svg xmlns="http://www.w3.org/2000/svg"><s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script></svg>',
    '<svg><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script></svg>',
    // Animation can set an href to a script URL that a click then runs.
    '<svg><a><set attributeName="href" to="&#106;avascript:alert(1)"/></a></svg>',
    '<svg><animate attributeName="href" to="x"/></svg>',
    '<svg><rect fill="url(https://tracker.example/x)"/></svg>',
    '<svg><style>@import "https://e.com/x.css";</style></svg>',
    '<svg><style>@\\69mport "https://e.com/x.css";</style></svg>',
  ]) assert.notEqual(screenSvg(bad), null, bad);
});

test('the stored extension comes from the path, else the media type', () => {
  assert.equal(imageExt({ kind: 'path', ref: 'a/b.jpeg' }), 'jpg');
  assert.equal(imageExt({ kind: 'url', ref: 'https://e.com/logo' }, 'image/webp; q=1'), 'webp');
  assert.equal(imageExt({ kind: 'url', ref: 'https://e.com/logo' }, 'text/html'), null);
});
