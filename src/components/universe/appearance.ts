// Planet decoration (1.9 §5 / B §5): `attributes.appearance = {hue, texture}` on a record's version, an open
// edge of `attributes` — no migration, no contract change. Names only, never hex: the palette fixes lightness
// so choosing a colour can never also choose brightness (the reserved review-support channel). Unknown values
// fall back to the default rather than being rejected — the server never validates attributes.
import type {Attributes} from '../../contracts/types';

export const HUES = ['none', 'lilac', 'rose', 'sand', 'teal', 'sky'] as const;
export type Hue = (typeof HUES)[number];

export const TEXTURES = ['smooth', 'grain', 'bands'] as const;
export type Texture = (typeof TEXTURES)[number];

/** OKLCH L 0.90 fixed for every hue (default included); only chroma and hue angle vary. Hex values are the
 * fixed point for that OKLCH triple, kept here (not computed at runtime) so the fill never drifts off L 0.90. */
export const HUE_HEX: Record<Hue, string> = {
  none: '#dfdbea',
  lilac: '#e2d8fc',
  rose: '#f9d1e3',
  sand: '#f2daba',
  teal: '#b8e9e8',
  sky: '#c6e1ff',
};

export type Appearance = {hue: Hue; texture: Texture; present: boolean};

const DEFAULT_APPEARANCE: Appearance = {hue: 'none', texture: 'smooth', present: false};

function isHue(value: unknown): value is Hue { return typeof value === 'string' && (HUES as readonly string[]).includes(value); }
function isTexture(value: unknown): value is Texture { return typeof value === 'string' && (TEXTURES as readonly string[]).includes(value); }

/** Reads `attributes.appearance`; anything missing, malformed or out of the fixed vocabulary falls back to the
 * default rather than being rejected (the server does not interpret attributes either). `present` is true only
 * when `attributes.appearance` is itself an object, so the reader's 20px portrait draws only when one was set. */
export function parseAppearance(attributes: Attributes | null | undefined): Appearance {
  const raw = attributes && typeof attributes === 'object' ? (attributes as Record<string, unknown>).appearance : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_APPEARANCE;
  const record = raw as Record<string, unknown>;
  const hue = isHue(record.hue) ? record.hue : 'none';
  const texture = isTexture(record.texture) ? record.texture : 'smooth';
  return {hue, texture, present: true};
}

export function hueHex(hue: Hue): string { return HUE_HEX[hue]; }
