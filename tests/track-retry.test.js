'use strict';
const test=require('node:test');
const assert=require('node:assert');
const {shouldRetry}=require('../lib/track-retry.js');
const NOW=new Date('2026-11-21T12:00:00Z');
const later=minutes=>new Date(+NOW+minutes*60000);

test('a failed generation gets one more try while its audio is still there',()=>{
  assert.strictEqual(shouldRetry({expires_at:later(60)},'CUDA out of memory',NOW),true);
  assert.strictEqual(shouldRetry({expires_at:later(60),retries:1},'CUDA out of memory',NOW),false);
  assert.strictEqual(shouldRetry({expires_at:later(2)},'timeout',NOW),false);
});

test('errors a second try cannot fix are not retried',()=>{
  for(const message of ['L’audio dépasse 10 minutes.','Cette vidéo est privée.','Vidéo introuvable.'])
    assert.strictEqual(shouldRetry({expires_at:later(60)},message,NOW),false,message);
});
