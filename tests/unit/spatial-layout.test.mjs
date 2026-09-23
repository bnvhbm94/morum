import test from 'node:test';import assert from 'node:assert/strict';
import {groupGalaxies,placeGalaxy,layoutEdges,layoutNodes} from '../../src/lib/spatial-data.ts';

const node=(id,topic=null)=>({key:`version:${id}`,target:{kind:'version',id},topic,duplicateOf:null});
const rel=(from,predicate,to)=>({predicate,from:{kind:'version',id:from},to:{kind:'version',id:to}});
const spiral=i=>({x:i+10,y:0});

test('galaxies group by declared topic, largest first, untagged last as 미분류',()=>{
  const g=groupGalaxies([node('a','x'),node('b'),node('c','y'),node('d','y')]);
  assert.deepEqual(g.map(x=>[x.key,x.nodes.length]),[['topic:y',2],['topic:x',1],['untagged',1]]);
  assert.equal(g.at(-1).label,'미분류');
  assert.deepEqual(groupGalaxies([node('a','x'),node('b','y')]).map(x=>x.key),['topic:x','topic:y']);
});

test('relation sides: support on the left, correction/derivation/dependency on the right',()=>{
  const keys=new Set(['version:a','version:b']);
  assert.deepEqual(layoutEdges([rel('a','supports','b')],keys).map(e=>[e.left,e.right]),[['version:a','version:b']]);
  for(const p of ['corrects','derived_from','depends_on'])
    assert.deepEqual(layoutEdges([rel('a',p,'b')],keys).map(e=>[e.left,e.right]),[['version:b','version:a']]);
  assert.equal(layoutEdges([rel('a','contradicts','b')],keys).length,0,'undeclared sides are not placed by relation');
  assert.equal(layoutEdges([rel('a','supports','z')],keys).length,0,'edges need both ends present');
});

test('related nodes take the adjacent cell; unrelated nodes fall back to the spiral',()=>{
  const placed=layoutNodes([node('a'),node('b'),node('c')],layoutEdges([rel('b','corrects','a')],new Set(['version:a','version:b','version:c'])),spiral);
  assert.deepEqual(placed.map(n=>[n.key,n.x,n.y]),[['version:a',0,0],['version:b',1,0],['version:c',10,0]]);
});

test('placeGalaxy pulls in related outsiders as foreign and dims corrected versions',()=>{
  const all=[node('a','x'),node('b','y')];
  const [gx]=groupGalaxies(all).filter(g=>g.key==='topic:x');
  const placed=placeGalaxy(gx,all,[rel('b','corrects','a')],spiral);
  assert.deepEqual(placed.map(p=>[p.node.key,p.foreign,p.dim]),[['version:a',false,true],['version:b',true,false]]);
  assert.deepEqual(placeGalaxy(gx,all,[],spiral).map(p=>p.node.key),['version:a']);
});
