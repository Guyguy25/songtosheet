'use strict';
const {effectiveTier}=require('./billing');
// Free accounts: a few 30 s previews in total, enough to judge the result, not enough to rebuild
// a whole song from successive excerpts. Failed previews do not count.
const FREE_PREVIEWS=3;
const COUNTED={$in:['queued','processing','completed']};

const limited=user=>Boolean(user&&!user.guest&&user.role!=='admin'&&effectiveTier(user)==='free');

async function freePreviewsLeft(db,user){
  if(!limited(user))return null;
  const used=await db.collection('track_jobs').countDocuments({user_id:user._id,preview_limit:{$exists:true},status:COUNTED});
  return Math.max(0,FREE_PREVIEWS-used);
}

const FREE_LIMIT_MESSAGE=`Tu as utilisé tes ${FREE_PREVIEWS} aperçus gratuits.`;

module.exports={FREE_PREVIEWS,freePreviewsLeft,FREE_LIMIT_MESSAGE};
