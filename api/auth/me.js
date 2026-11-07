'use strict';
const {authenticated,publicUser,json}=require('../../lib/session');
const {method,fail}=require('../../lib/authorization');
module.exports=async(req,res)=>{
  if(!method(req,res,'GET'))return;
  try{const user=await authenticated(req);return json(res,200,{user:publicUser(user)});}
  catch(e){return fail(res,e);}
};
