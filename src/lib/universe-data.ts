import type {SpatialPage} from './spatial-data';
import {groupGalaxies, loadSpatialHome} from './spatial-data';
import type {UniverseSource} from '../components/universe/types';

export function topicLayoutSeed(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
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

  return {
    async children(at, signal) {
      if (at !== null) {
        return [];
      }

      const page = await ensureLoaded(signal);
      const galaxies = groupGalaxies(page.nodes);

      return galaxies.map((galaxy) => ({
        id: galaxy.key,
        label: galaxy.label,
        mass: galaxy.nodes.length,
        directCount: galaxy.nodes.length,
        childCount: 0,
        layoutSeed: topicLayoutSeed(galaxy.key),
      }));
    },

    async items(categoryId, signal) {
      const page = await ensureLoaded(signal);
      const galaxies = groupGalaxies(page.nodes);

      const galaxy = galaxies.find((g) => g.key === categoryId);
      if (!galaxy) {
        return [];
      }

      return galaxy.nodes.map((node) => ({
        id: node.key,
        kind: 'record' as const,
        title: node.title,
        snippet: node.snippet,
        href: node.href,
        versionId: node.target.kind === 'version' ? node.target.id : null,
        node,
      }));
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
