'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {cleanProfile}=require('../lib/profile');

const webp='data:image/webp;base64,'+Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPVP8 '),Buffer.alloc(20)]).toString('base64');

test('pseudo, bio and photo are kept; email and phone are not editable here',()=>{
  assert.deepEqual(cleanProfile({pseudo:'  Tanguy  Guitare ',bio:' Guitariste du Nord. ',avatar:webp,email:'x@y.fr',phone:'0600000000'}),
    {pseudo:'Tanguy Guitare',bio:'Guitariste du Nord.',avatar:webp});
  assert.deepEqual(cleanProfile({avatar:null}),{avatar:null});
  assert.deepEqual(cleanProfile({pseudo:''}),{pseudo:''});
});

test('refuses what does not fit',()=>{
  assert.throws(()=>cleanProfile({pseudo:'x'}),/pseudo/);
  assert.throws(()=>cleanProfile({pseudo:'<script>'}),/pseudo/);
  assert.throws(()=>cleanProfile({bio:'a'.repeat(281)}),/280/);
  assert.throws(()=>cleanProfile({avatar:'data:image/webp;base64,'+Buffer.from('not an image').toString('base64')}),/image/);
  assert.throws(()=>cleanProfile({avatar:'https://example.com/a.png'}),/image/);
  assert.throws(()=>cleanProfile({avatar:'data:image/png;base64,'+'A'.repeat(130000)}),/image/);
  assert.throws(()=>cleanProfile({email:'x@y.fr'}),/Rien/);
});
