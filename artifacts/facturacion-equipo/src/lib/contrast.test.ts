import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const pageFiles = [
  ['invoice detail', new URL('../pages/invoice-detail.tsx', import.meta.url)],
  ['settlements', new URL('../pages/settlements.tsx', import.meta.url)],
  ['catalogs', new URL('../pages/catalogs.tsx', import.meta.url)],
] as const;
const pageSources = pageFiles.map(([name, url]) => ({ name, source: readFileSync(url, 'utf8') }));
const lightSurfaces = ['#fffefa', '#e9f0f2', '#efeee5'];

function luminance(hex: string) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssRules() {
  return [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selector, declarations]) => ({
    selectors: selector.split(',').map((part) => part.trim()),
    declarations,
  }));
}

function rootVariable(name: string) {
  const root = cssRules().find((rule) => rule.selectors.includes(':root'))?.declarations;
  const value = root?.match(new RegExp(`--${name}:\\s*([^;]+)`))?.[1]?.trim();
  assert.ok(value, `Missing CSS variable --${name}`);
  return value;
}

function parseHsl(value: string) {
  const match = value.match(/^\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/);
  assert.ok(match, `Unsupported HSL value: ${value}`);
  const h = ((Number(match[1]) % 360) + 360) % 360 / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const hueToRgb = (p: number, q: number, t: number) => {
    let adjusted = t;
    if (adjusted < 0) adjusted += 1;
    if (adjusted > 1) adjusted -= 1;
    if (adjusted < 1 / 6) return p + (q - p) * 6 * adjusted;
    if (adjusted < 1 / 2) return q;
    if (adjusted < 2 / 3) return p + (q - p) * (2 / 3 - adjusted) * 6;
    return p;
  };
  if (s === 0) {
    const gray = Math.round(l * 255).toString(16).padStart(2, '0');
    return `#${gray}${gray}${gray}`;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return `#${[hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)]
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
}

function resolveColor(value: string): string {
  const trimmed = value.trim().replace(/\s*!important$/, '');
  if (/^#[\da-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const hslVariable = trimmed.match(/^hsl\(var\(--([\w-]+)\)\)$/);
  if (hslVariable) return parseHsl(rootVariable(hslVariable[1]));
  const variable = trimmed.match(/^var\(--([\w-]+)\)$/);
  if (variable) return resolveColor(rootVariable(variable[1]));
  const hsl = trimmed.match(/^hsl\(([^)]+)\)$/);
  if (hsl) return parseHsl(hsl[1]);
  assert.fail(`Unsupported color value in contrast audit: ${value}`);
}

function declarationsFor(selector: string) {
  const rule = cssRules().find((candidate) => candidate.selectors.includes(selector));
  assert.ok(rule, `Missing CSS rule for ${selector}`);
  return rule.declarations;
}

function declarationColor(selector: string, property: string) {
  const declarations = declarationsFor(selector);
  const expression = property === 'border-color'
    ? /border(?:-color)?:\s*(?:\d+px\s+\w+\s+)?(#[\da-f]{6}|var\(--[\w-]+\))/i
    : new RegExp(`${property}:\\s*(hsl\\(var\\(--[\\w-]+\\)\\)|var\\(--[\\w-]+\\)|#[\\da-f]{6})`, 'i');
  const value = declarations.match(expression)?.[1];
  assert.ok(value, `Missing ${property} declaration in ${selector}`);
  return resolveColor(value);
}

function utilityTextColor(hex: string) {
  const classSelector = `.text-\\[\\#${hex}\\]`;
  const rule = cssRules().find((candidate) => candidate.selectors.includes(classSelector));
  if (!rule) return `#${hex}`;
  const value = rule.declarations.match(/color:\s*(var\(--[\w-]+\)|#[\da-f]{6})/i)?.[1];
  assert.ok(value, `Missing text color declaration for ${classSelector}`);
  return resolveColor(value);
}

function assertContrast(foreground: string, background: string, minimum: number, label: string) {
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= minimum, `${label}: ${foreground} against ${background} is ${ratio.toFixed(2)}:1; requires ${minimum}:1`);
}

test('all explicit text colors in invoice, settlement, and catalog pages meet normal-text contrast', () => {
  const darkSurfaceText = new Set(['f5f3e9', 'c3d0c6', 'd6bd84']);
  for (const { name, source } of pageSources) {
    const textColors = [...new Set([...source.matchAll(/text-\[#([\da-f]{6})\]/gi)].map((match) => match[1].toLowerCase()))];
    for (const hex of textColors) {
      if (darkSurfaceText.has(hex)) continue;
      const foreground = utilityTextColor(hex);
      for (const background of lightSurfaces) {
        assertContrast(foreground, background, 4.5, `${name} text-[#${hex}]`);
      }
    }
  }
  const eyebrow = declarationColor('.eyebrow', 'color');
  const fieldLabel = declarationColor('.field-label', 'color');
  for (const background of lightSurfaces) {
    assertContrast(eyebrow, background, 4.5, 'eyebrow text');
    assertContrast(fieldLabel, background, 4.5, 'field label');
  }
});

test('large headings retain at least 3:1 contrast on the page and card surfaces', () => {
  const foreground = parseHsl(rootVariable('foreground'));
  const backgrounds = [parseHsl(rootVariable('background')), parseHsl(rootVariable('card'))];
  for (const background of backgrounds) assertContrast(foreground, background, 3, 'large heading');
});

test('invoice, settlement, and catalog alerts retain readable semantic foregrounds', () => {
  const alertPairs = [
    ['invoice detail', '#a04539', '#fbefeb'],
    ['invoice detail', '#377668', '#e6f2e9'],
    ['settlements', '#984b40', '#fbefeb'],
    ['settlements', '#725b2c', '#fbf2df'],
    ['settlements', '#77551d', '#fbf0df'],
    ['catalogs', '#a04539', '#fbefeb'],
    ['catalogs', '#317060', '#e6f2e9'],
    ['catalogs', '#775d2d', '#fcf5e6'],
    ['catalogs', '#9a6960', '#f1e7e4'],
  ] as const;
  for (const [page, foreground, background] of alertPairs) {
    const source = pageSources.find(({ name }) => name === page)?.source;
    assert.ok(source, `Missing audited page: ${page}`);
    assert.ok(source.includes(`text-[${foreground}]`), `${page} no longer includes the audited alert/status foreground ${foreground}`);
    assert.ok(source.includes(`bg-[${background}]`), `${page} no longer includes the audited alert/status background ${background}`);
    assertContrast(utilityTextColor(foreground.slice(1)), background, 4.5, `${page} alert/status`);
  }
});

test('invoice status pills keep their semantic error, warning, and success colors readable', () => {
  const statusRules = ['.status-draft', '.status-sent', '.status-paid', '.status-finished', '.status-accepted', '.status-confirmed', '.status-voided', '.status-error', '.status-cancelled'];
  for (const selector of statusRules) {
    const foreground = declarationColor(selector, 'color');
    const background = declarationColor(selector, 'background');
    assertContrast(foreground, background, 4.5, selector);
  }
  assert.equal(declarationColor('.status-error', 'color'), '#a03832');
  assert.equal(declarationColor('.status-sent', 'color'), '#8a5e17');
  assert.equal(declarationColor('.status-paid', 'color'), '#176d55');
});

test('interactive controls provide readable labels and 3:1 boundaries on light surfaces', () => {
  for (const selector of ['.button-primary', '.button-soft', '.button-danger']) {
    const foreground = declarationColor(selector, 'color');
    const background = declarationColor(selector, 'background');
    assertContrast(foreground, background, 4.5, `${selector} label`);
  }

  const plainForeground = declarationColor('.button-plain', 'color');
  for (const background of lightSurfaces) assertContrast(plainForeground, background, 4.5, 'plain button label');

  const fieldForeground = declarationColor('.field', 'color');
  const fieldBackground = declarationColor('.field', 'background');
  assertContrast(fieldForeground, fieldBackground, 4.5, 'field text');

  const controlBorders = [
    declarationColor('.button-soft', 'border-color'),
    declarationColor('.button-plain', 'border-color'),
    declarationColor('.field', 'border-color'),
    declarationColor('.button-danger', 'border-color'),
    declarationColor('.catalog-tab', 'border-color'),
    '#49867c',
  ];
  for (const border of controlBorders) {
    for (const background of ['#fffefa', '#e9f0f2', '#f4f7f5', '#f8faf9', '#e7f2f6', '#fff1ef', '#f1f6f2']) {
      assertContrast(border, background, 3, 'control boundary/focus indicator');
    }
  }
  assertContrast(declarationColor('.button-primary', 'background'), '#fffefa', 3, 'primary button boundary');
  assertContrast(declarationColor('.field:focus', 'border-color'), '#f8faf9', 3, 'focused field boundary');
  const focusRule = cssRules().find((rule) => rule.selectors.includes('button:focus-visible'));
  const focusColor = focusRule?.declarations.match(/outline:\s*\d+px\s+solid\s+(#[\da-f]{6})/i)?.[1];
  assert.ok(focusColor, 'Missing visible keyboard-focus outline');
  for (const background of ['#fffefa', '#e9f0f2', '#f4f7f5']) {
    assertContrast(focusColor, background, 3, 'keyboard focus indicator');
  }
  assert.ok(pageSources.find(({ name }) => name === 'catalogs')?.source.includes('catalog-tab'), 'Catalog filter buttons must use the audited control border');
  assert.ok(pageSources.find(({ name }) => name === 'catalogs')?.source.includes('!border-[#49867c]'), 'Active catalog filter buttons must keep an audited boundary');
  assert.ok(pageSources.find(({ name }) => name === 'settlements')?.source.includes('border-[#718994]'), 'Settlement period control must use the audited control border');
});

test('light settlement metric text remains contrasted against its dark semantic panel', () => {
  const settlements = pageSources.find(({ name }) => name === 'settlements')!.source;
  for (const color of ['f5f3e9', 'c3d0c6', 'd6bd84']) {
    assert.ok(settlements.includes(`text-[#${color}]`), `Expected dark-panel foreground text-[#${color}]`);
    assertContrast(`#${color}`, '#244a44', 4.5, `dark settlement metric text-[#${color}]`);
  }
});
