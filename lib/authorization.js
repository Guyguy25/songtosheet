'use strict';
const {json,allowed}=require('./session');
function method(req,res,verb){
  if(req.method!==verb){res.setHeader('Allow',verb);json(res,405,{detail:'Méthode non autorisée.'});return false;}
  if(verb!=='GET'&&!allowed(req)){json(res,403,{detail:'Origine non autorisée.'});return false;}
  return true;
}
function credentials(body){
  const email=String(body?.email||'').trim().toLowerCase();
  const password=body?.password;
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Indique une adresse email valide.');
  if(typeof password!=='string'||password.length<8||password.length>128)throw new Error('Utilise un mot de passe de 8 à 128 caractères.');
  return {email,password};
}
function fail(res,error){
  if(error?.code===11000)return json(res,409,{detail:'Cette adresse email possède déjà un compte. Connecte-toi.'});
  if(error?.message?.includes('MongoDB n’est pas configuré'))return json(res,503,{detail:'Le service de comptes est momentanément indisponible.'});
  return json(res,503,{detail:'Service indisponible. Réessaie un peu plus tard.'});
}
module.exports={method,credentials,fail};
