import test from 'node:test';import assert from 'node:assert/strict';
import {clientBucket} from '../../.test-build/server/service/rate-limit.js';

test('IPv4 addresses pass through unchanged (bucket names must stay stable)',()=>{
 assert.equal(clientBucket('203.0.113.7'),'203.0.113.7');
 assert.equal(clientBucket('127.0.0.1'),'127.0.0.1');
});

test('IPv6 loopback normalises to its /64 (all-zero) prefix',()=>{
 assert.equal(clientBucket('::1'),'0000:0000:0000:0000');
});

test('IPv6 addresses in the same /64 share a bucket',()=>{
 assert.equal(clientBucket('2001:db8::1'),clientBucket('2001:db8::5'));
 assert.equal(clientBucket('2001:db8::1'),clientBucket('2001:db8:0:0:1:2:3:4'));
 assert.equal(clientBucket('2001:db8::1'),'2001:0db8:0000:0000');
});

test('IPv6 addresses in different /64s get different buckets',()=>{
 assert.notEqual(clientBucket('2001:db8:0:1::1'),clientBucket('2001:db8:0:2::1'));
});
