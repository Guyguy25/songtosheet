'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
async function make(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const key=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
  return 'scrypt-v1$'+salt+'$'+key.toString('hex');
}
async function matches(password,encoded){
  if(typeof encoded!=='string'||!encoded.startsWith('scrypt-v1$'))return false;
  const parts=encoded.split('$');if(parts.length!==3||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;
  const actual=await scrypt(password,parts[1],64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
  const expected=Buffer.from(parts[2],'hex');
  return crypto.timingSafeEqual(actual,expected);
}
module.exports={make,matches};
