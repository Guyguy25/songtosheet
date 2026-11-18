'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizePhone}=require('../lib/phone');

test('French numbers typed any usual way end up in international form',()=>{
  for(const input of ['06 12 34 56 78','0612345678','06.12.34.56.78','06-12-34-56-78','+33 6 12 34 56 78','+33612345678','0033612345678','+33 (0)6 12 34 56 78'])
    assert.equal(normalizePhone(input),'+33612345678',input);
});

test('other countries with their code',()=>{
  assert.equal(normalizePhone('+32 470 12 34 56'),'+32470123456');
  assert.equal(normalizePhone('+1 (415) 555-0100'),'+14155550100');
});

test('rejects what is not a phone number',()=>{
  for(const input of ['','123','06 12 34','abc','+0612345678','612345678','06 12 34 56 78 90 12'])
    assert.throws(()=>normalizePhone(input),/numéro de téléphone valide/,input);
});
