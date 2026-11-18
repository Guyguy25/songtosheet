'use strict';
// Phone numbers at sign-up, stored in international (E.164) form: +33612345678.
// French numbers can be typed the usual way (06 12 34 56 78); others need their +country code.
function normalizePhone(value){
  const raw=String(value??'').trim();
  const compact=raw.replace(/[\s.\-()/]/g,'');
  let digits=null;
  if(/^\+\d{8,15}$/.test(compact))digits=compact;
  else if(/^00\d{8,15}$/.test(compact))digits='+'+compact.slice(2);
  else if(/^0[1-9]\d{8}$/.test(compact))digits='+33'+compact.slice(1);
  if(!digits||/^\+0/.test(digits))throw new Error('Indique un numéro de téléphone valide, par exemple 06 12 34 56 78.');
  if(digits.startsWith('+330'))digits='+33'+digits.slice(4);
  return digits;
}
module.exports={normalizePhone};
