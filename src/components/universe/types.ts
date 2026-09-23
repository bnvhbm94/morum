import type {SpatialNode} from '../../lib/spatial-data';

/** A circle in world units. The root universe is one circle; every category lives inside its primary parent's circle. */
export type Circle = {x: number; y: number; r: number};

/** Camera: (x, y) is the world point shown at the viewport centre; scale is screen pixels per world unit. */
export type Camera = {x: number; y: number; scale: number};

export type Viewport = {width: number; height: number};

/** A category as the universe needs it. mass sizes the circle only; directCount is what may be stated as a count. */
export type UniverseCategory = {
  id: string;
  label: string;
  mass: number;
  directCount: number;
  childCount: number;
  layoutSeed: number;
};

/** A record or archived source directly classified into a category. */
export type UniverseItem = {
  id: string;
  kind: 'record' | 'source';
  title: string;
  snippet: string;
  href: string;
  versionId: string | null;
  node: SpatialNode;
};

/** Where the universe reads from. Phase 0 backs this with records' attributes.topic; phase 3 swaps in /universe. */
export interface UniverseSource {
  /** Children of a category, or the roots when `at` is null. */
  children(at: string | null, signal?: AbortSignal): Promise<UniverseCategory[]>;
  /** Items classified directly into a category. */
  items(categoryId: string, signal?: AbortSignal): Promise<UniverseItem[]>;
  /** Category ids from a root down to the category holding this version, or [] when it is unclassified or unknown. */
  pathTo(versionId: string, signal?: AbortSignal): Promise<string[]>;
}
