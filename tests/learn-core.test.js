'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildLevels,groupAttacks,judge,multiplier,starsFor,xpFor,SPEEDS,LISTEN_SPEED}=require('../backend/web/learn-core.js');

test('2 mesures par niveau, 4 niveaux + boss par section',()=>{
  const measures=[0,2,4,6,8,10,12,14,16,18];
  const notes=measures.flatMap(m=>[{time:m,midi:60,duration:.5},{time:m+1,midi:62,duration:.5}]);
  const levels=buildLevels(notes,measures);
  assert.deepEqual(levels.filter(l=>!l.boss).map(l=>[l.start,l.end]),[[0,4],[4,8],[8,12],[12,16],[16,20]]);
  assert.equal(levels[4].boss,true);assert.equal(levels[4].section,0);
  assert.deepEqual([levels[4].start,levels[4].end],[0,16]);
  assert.deepEqual(levels.map(l=>l.index),levels.map((_,i)=>i));
});
test('intro silencieuse : pas de niveau vide, départ sur la première note',()=>{
  const levels=buildLevels([{time:9.5,midi:60,duration:.5},{time:11,midi:62,duration:.5}],[0,2,4,6,8,10,12]);
  assert.equal(levels.filter(l=>!l.boss).length,1);
  assert.equal(levels[0].start,9.5);
});
test('aperçu freemium : rien après previewEnd',()=>{
  const notes=[0,1,2,3,4,5,6,7,8,9].map(t=>({time:t,midi:60,duration:.4}));
  const levels=buildLevels(notes,[0,2,4,6,8],{previewEnd:5});
  assert.ok(levels.length>0);
  assert.ok(levels.every(l=>l.end<=5&&l.notes.every(n=>n.time<5)));
});
test('sans mesures : fenêtres de 6 s',()=>{
  const notes=[0,3,6.2,9,12.5].map(t=>({time:t,midi:60,duration:.3}));
  assert.equal(buildLevels(notes,[]).filter(l=>!l.boss).length,3);
});
test('niveau trop long : redécoupé mesure par mesure',()=>{
  const measures=[0,6,12,18];
  const notes=[0,3,6,9,12,15,18,21].map(t=>({time:t,midi:60,duration:.3}));
  const lv=buildLevels(notes,measures).filter(l=>!l.boss);
  assert.ok(lv.every(l=>l.end-l.start<=10));
});
test('jugement, combo, étoiles, XP',()=>{
  assert.equal(judge(.08),'perfect');assert.equal(judge(-.16),'good');assert.equal(judge(.161),'miss');
  assert.deepEqual([9,10,20,40].map(multiplier),[1,2,3,4]);
  assert.equal(starsFor(.96,1),3);assert.equal(starsFor(.96,.8),2);assert.equal(starsFor(.8,1),2);
  assert.equal(starsFor(.6,.6),1);assert.equal(starsFor(.59,1),0);
  assert.equal(xpFor({notes:20,accuracy:.9,speed:1,boss:false}),180);
  assert.equal(xpFor({notes:20,accuracy:.9,speed:1,boss:true}),280);
  assert.equal(xpFor({notes:20,accuracy:.5,speed:1,boss:true}),100);
  assert.equal(xpFor({notes:9999,accuracy:9,speed:9,boss:false}),3000);
  assert.deepEqual(SPEEDS,[.6,.8,1]);assert.equal(LISTEN_SPEED,.75);
});
test('accords groupés à 60 ms',()=>{
  const attacks=groupAttacks([{time:1,midi:40},{time:1.03,midi:47},{time:1.5,midi:52}]);
  assert.deepEqual(attacks.map(a=>a.midis),[[40,47],[52]]);
});

test('boss : le bonus de couronne demande la vitesse réelle',()=>{
  assert.equal(xpFor({notes:20,accuracy:1,speed:.6,boss:true}),120);
  assert.equal(xpFor({notes:20,accuracy:1,speed:1,boss:true}),300);
});
test('clic du métronome : les trames proches sont ignorées',()=>{
  const {nearClick}=require('../backend/web/learn-core.js');
  assert.equal(nearClick([1,2,3],2.05),true);
  assert.equal(nearClick([1,2,3],2.2),false);
  assert.equal(nearClick([],2),false);
});
