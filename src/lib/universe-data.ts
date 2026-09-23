import type {SpatialNode, SpatialPage} from './spatial-data';
import {groupGalaxies, loadSpatialHome} from './spatial-data';
import type {UniverseCategory, UniverseItem, UniverseSource} from '../components/universe/types';

export function topicLayoutSeed(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function toItem(node: SpatialNode): UniverseItem {
  return {
    id: node.key,
    kind: 'record' as const,
    title: node.title,
    snippet: node.snippet,
    href: node.href,
    versionId: node.target.kind === 'version' ? node.target.id : null,
    node,
  };
}

/** Phase-0 source: today's flat attributes.topic groups stand in for root categories until /universe exists. */
export function createTopicSource(load: (signal?: AbortSignal) => Promise<SpatialPage> = loadSpatialHome): UniverseSource {
  let loadPromise: Promise<SpatialPage> | null = null;

  async function ensureLoaded(signal?: AbortSignal): Promise<SpatialPage> {
    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = load(signal).catch((error) => {
      loadPromise = null;
      throw error;
    });

    return loadPromise;
  }

  async function galaxy(categoryId: string, signal?: AbortSignal) {
    const page = await ensureLoaded(signal);
    return groupGalaxies(page.nodes).find((g) => g.key === categoryId) ?? null;
  }

  return {
    async children(at, signal) {
      if (at !== null) {
        return [];
      }

      const page = await ensureLoaded(signal);
      const galaxies = groupGalaxies(page.nodes);

      return galaxies.map((galaxy) => {
        const planets = galaxy.nodes.filter((node) => node.role !== 'star');
        return {
          id: galaxy.key,
          label: galaxy.label,
          mass: planets.length,
          directCount: planets.length,
          childCount: 0,
          layoutSeed: topicLayoutSeed(galaxy.key),
        };
      });
    },

    async items(categoryId, signal) {
      const found = await galaxy(categoryId, signal);
      return found ? found.nodes.filter((node) => node.role !== 'star').map(toItem) : [];
    },

    async star(categoryId, signal) {
      const found = await galaxy(categoryId, signal);
      // The home window lists records newest first, so the first star-role record is the latest description.
      const node = found?.nodes.find((candidate) => candidate.role === 'star');
      return node ? toItem(node) : null;
    },

    async pathTo(versionId, signal) {
      const page = await ensureLoaded(signal);
      const galaxies = groupGalaxies(page.nodes);

      for (const galaxy of galaxies) {
        for (const node of galaxy.nodes) {
          if (node.target.kind === 'version' && node.target.id === versionId) {
            return [galaxy.key];
          }
        }
      }

      return [];
    },
  };
}

/** A category tree for tests and previews of the layered universe: `children` nest, `items` are plain records. */
export type TreeCategory = {id: string; label: string; children?: TreeCategory[]; items?: {id: string; title: string; snippet?: string; star?: boolean}[]};

/** In-memory source over a nested tree, so galaxies (categories with subcategories) can be exercised before the category API exists. */
export function createTreeSource(roots: TreeCategory[]): UniverseSource {
  const byId = new Map<string, TreeCategory>();
  const parentOf = new Map<string, string | null>();
  const visit = (nodes: TreeCategory[], parent: string | null) => {
    for (const node of nodes) { byId.set(node.id, node); parentOf.set(node.id, parent); visit(node.children ?? [], node.id); }
  };
  visit(roots, null);

  const mass = (node: TreeCategory): number => (node.items ?? []).filter((item) => !item.star).length + (node.children ?? []).reduce((sum, child) => sum + mass(child), 0);
  const toCategory = (node: TreeCategory): UniverseCategory => ({
    id: node.id,
    label: node.label,
    mass: Math.max(mass(node), 0.25),
    directCount: (node.items ?? []).filter((item) => !item.star).length,
    childCount: (node.children ?? []).length,
    layoutSeed: topicLayoutSeed(node.id),
  });
  const toTreeItem = (categoryId: string, item: {id: string; title: string; snippet?: string; star?: boolean}): UniverseItem => {
    const target = {kind: 'version' as const, id: item.id};
    return {
      id: `version:${item.id}`,
      kind: 'record',
      title: item.title,
      snippet: item.snippet ?? '',
      href: `/versions/${encodeURIComponent(item.id)}`,
      versionId: item.id,
      node: {key: `version:${item.id}`, target, locator: null, locators: [], title: item.title, snippet: item.snippet ?? '', href: `/versions/${encodeURIComponent(item.id)}`, isCurrent: true, versionState: 'current', score: null, syntheticDemo: false, topic: categoryId, untitled: !item.title, duplicateOf: null, role: item.star ? 'star' : null, createdAt: null, reviewCount: null},
    };
  };

  return {
    async children(at) {
      const nodes = at === null ? roots : (byId.get(at)?.children ?? []);
      return nodes.map(toCategory);
    },
    async items(categoryId) {
      return (byId.get(categoryId)?.items ?? []).filter((item) => !item.star).map((item) => toTreeItem(categoryId, item));
    },
    async star(categoryId) {
      const item = (byId.get(categoryId)?.items ?? []).find((candidate) => candidate.star);
      return item ? toTreeItem(categoryId, item) : null;
    },
    async pathTo(versionId) {
      for (const [id, node] of byId) {
        if (!(node.items ?? []).some((item) => item.id === versionId)) continue;
        const path: string[] = [];
        let cursor: string | null = id;
        while (cursor) { path.unshift(cursor); cursor = parentOf.get(cursor) ?? null; }
        return path;
      }
      return [];
    },
  };
}
