import {test, describe} from 'node:test';
import {strict as assert} from 'node:assert';
import {createTopicSource, topicLayoutSeed} from '../../src/lib/universe-data.ts';

describe('universe-data', () => {
  describe('topicLayoutSeed', () => {
    test('is deterministic', () => {
      const seed1 = topicLayoutSeed('test-key');
      const seed2 = topicLayoutSeed('test-key');
      assert.equal(seed1, seed2);
    });

    test('differs for different keys', () => {
      const seed1 = topicLayoutSeed('key1');
      const seed2 = topicLayoutSeed('key2');
      assert.notEqual(seed1, seed2);
    });

    test('is a 32-bit unsigned integer', () => {
      const seed = topicLayoutSeed('test');
      assert(Number.isInteger(seed));
      assert(seed >= 0 && seed <= 0xffffffff);
    });
  });

  describe('createTopicSource', () => {
    function makeNode(overrides = {}) {
      return {
        key: 'version:123',
        target: {kind: 'version', id: 'v1'},
        locator: null,
        locators: [],
        title: 'Test Title',
        snippet: 'Test snippet',
        href: '/test',
        isCurrent: true,
        versionState: 'current',
        score: null,
        syntheticDemo: false,
        topic: 'Test Topic',
        untitled: false,
        duplicateOf: null,
        ...overrides,
      };
    }

    test('roots come from topics, largest first, untagged last', async () => {
      const nodes = [
        makeNode({key: 'v:1', topic: 'Alpha', target: {kind: 'version', id: '1'}}),
        makeNode({key: 'v:2', topic: 'Alpha', target: {kind: 'version', id: '2'}}),
        makeNode({key: 'v:3', topic: 'Beta', target: {kind: 'version', id: '3'}}),
        makeNode({key: 'v:4', topic: null, target: {kind: 'version', id: '4'}}),
      ];

      const loader = async () => ({nodes, page: {}, hasMore: false});
      const source = createTopicSource(loader);

      const categories = await source.children(null);

      assert.equal(categories.length, 3);
      // Largest first
      assert.equal(categories[0].label, 'Alpha');
      assert.equal(categories[0].mass, 2);
      assert.equal(categories[0].directCount, 2);
      assert.equal(categories[0].childCount, 0);
      // Second largest
      assert.equal(categories[1].label, 'Beta');
      assert.equal(categories[1].mass, 1);
      assert.equal(categories[1].directCount, 1);
      assert.equal(categories[1].childCount, 0);
      // Untagged last
      assert.equal(categories[2].label, '미분류');
      assert.equal(categories[2].mass, 1);
      assert.equal(categories[2].directCount, 1);
      assert.equal(categories[2].childCount, 0);
    });

    test('children(id) returns empty array', async () => {
      const loader = async () => ({nodes: [makeNode()], page: {}, hasMore: false});
      const source = createTopicSource(loader);

      const children = await source.children('topic:test');

      assert.deepEqual(children, []);
    });

    test('items returns members with versionId set', async () => {
      const nodes = [
        makeNode({key: 'v:1', topic: 'Test', target: {kind: 'version', id: 'id1'}}),
        makeNode({key: 'v:2', topic: 'Test', target: {kind: 'version', id: 'id2'}}),
      ];

      const loader = async () => ({nodes, page: {}, hasMore: false});
      const source = createTopicSource(loader);

      const items = await source.items('topic:Test');

      assert.equal(items.length, 2);
      assert.equal(items[0].id, 'v:1');
      assert.equal(items[0].versionId, 'id1');
      assert.equal(items[0].kind, 'record');
      assert.equal(items[1].id, 'v:2');
      assert.equal(items[1].versionId, 'id2');
    });

    test('items returns empty for unknown id', async () => {
      const loader = async () => ({nodes: [makeNode()], page: {}, hasMore: false});
      const source = createTopicSource(loader);

      const items = await source.items('unknown-id');

      assert.deepEqual(items, []);
    });

    test('pathTo finds the topic key for a member version', async () => {
      const nodes = [
        makeNode({key: 'v:1', topic: 'Alpha', target: {kind: 'version', id: 'version-123'}}),
        makeNode({key: 'v:2', topic: 'Beta', target: {kind: 'version', id: 'version-456'}}),
      ];

      const loader = async () => ({nodes, page: {}, hasMore: false});
      const source = createTopicSource(loader);

      const path = await source.pathTo('version-123');

      assert.deepEqual(path, ['topic:Alpha']);
    });

    test('pathTo returns empty for unknown version', async () => {
      const loader = async () => ({nodes: [makeNode()], page: {}, hasMore: false});
      const source = createTopicSource(loader);

      const path = await source.pathTo('unknown-version');

      assert.deepEqual(path, []);
    });

    test('loader runs once across several calls', async () => {
      let callCount = 0;
      const loader = async () => {
        callCount += 1;
        return {nodes: [makeNode()], page: {}, hasMore: false};
      };

      const source = createTopicSource(loader);

      await source.children(null);
      await source.items('topic:Test');
      await source.pathTo('version-123');

      assert.equal(callCount, 1);
    });

    test('after rejected load, next call retries and succeeds', async () => {
      let callCount = 0;
      const loader = async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('Load failed');
        }
        return {nodes: [makeNode()], page: {}, hasMore: false};
      };

      const source = createTopicSource(loader);

      try {
        await source.children(null);
      } catch (error) {
        // Expected to fail
      }

      const categories = await source.children(null);

      assert(callCount >= 2);
      assert.equal(categories.length, 1);
    });

    test('layoutSeed differs for different keys', async () => {
      const nodes = [
        makeNode({key: 'v:1', topic: 'Topic1', target: {kind: 'version', id: '1'}}),
        makeNode({key: 'v:2', topic: 'Topic2', target: {kind: 'version', id: '2'}}),
      ];

      const loader = async () => ({nodes, page: {}, hasMore: false});
      const source = createTopicSource(loader);

      const categories = await source.children(null);

      const seed1 = categories[0].layoutSeed;
      const seed2 = categories[1].layoutSeed;
      assert.notEqual(seed1, seed2);
    });
  });
});
