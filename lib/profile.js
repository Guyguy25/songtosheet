'use strict';
// What a person can change on their profile: pseudo, bio and photo. Email and phone stay as signed up.
const PSEUDO=/^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,30}$/u;
const AVATAR=/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;
const AVATAR_MAX=120000;
const MAGIC={webp:b=>b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP',
  jpeg:b=>b[0]===0xff&&b[1]===0xd8,png:b=>b.subarray(1,4).toString('ascii')==='PNG'};
const fail=message=>Object.assign(new Error(message),{status:400});

function cleanProfile(body){
  const update={};
  if(Object.hasOwn(body,'pseudo')){
    const pseudo=String(body.pseudo??'').trim().replace(/\s+/g,' ');
    if(pseudo&&!PSEUDO.test(pseudo))throw fail('Ton pseudo doit faire 2 à 31 caractères : lettres, chiffres, espaces, points, tirets.');
    update.pseudo=pseudo;
  }
  if(Object.hasOwn(body,'bio')){
    const bio=String(body.bio??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').trim();
    if(bio.length>280)throw fail('Ta bio peut faire 280 caractères au maximum.');
    update.bio=bio;
  }
  if(Object.hasOwn(body,'avatar')){
    if(body.avatar===null)update.avatar=null;
    else{
      const match=typeof body.avatar==='string'&&body.avatar.length<=AVATAR_MAX&&AVATAR.exec(body.avatar);
      if(!match||!MAGIC[match[1]](Buffer.from(match[2],'base64')))throw fail('Cette image ne peut pas être utilisée. Essaie une autre photo.');
      update.avatar=body.avatar;
    }
  }
  if(!Object.keys(update).length)throw fail('Rien à enregistrer.');
  return update;
}
module.exports={cleanProfile,AVATAR_MAX};
