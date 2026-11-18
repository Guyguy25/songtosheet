'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isoSeconds,youtubeTooLong}=require('../lib/audio-limit');

const api=iso=>async()=>new Response(JSON.stringify({items:[{id:'dQw4w9WgXcQ',contentDetails:{duration:iso}}]}),{status:200});

test('reads YouTube ISO durations',()=>{
  assert.equal(isoSeconds('PT6M28S'),388);
  assert.equal(isoSeconds('PT1H2M'),3720);
  assert.equal(isoSeconds('nope'),null);
});

test('over 10 minutes is refused, 10 minutes or less goes through',async()=>{
  process.env.YOUTUBE_DATA_API_KEY='test';
  try{
    assert.equal(await youtubeTooLong('dQw4w9WgXcQ',api('PT10M')),false);
    assert.equal(await youtubeTooLong('dQw4w9WgXcQ',api('PT6M28S')),false);
    assert.equal(await youtubeTooLong('dQw4w9WgXcQ',api('PT10M30S')),true);
    // API down or unknown video: the engine checks after download instead.
    assert.equal(await youtubeTooLong('dQw4w9WgXcQ',async()=>{throw new Error('down');}),false);
  }finally{delete process.env.YOUTUBE_DATA_API_KEY;}
});
