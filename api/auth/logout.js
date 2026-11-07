'use strict';
const {clear,json}=require('../../lib/session');
const {method}=require('../../lib/authorization');
module.exports=async(req,res)=>{
  if(!method(req,res,'POST'))return;
  clear(res);
  return json(res,200,{ok:true});
};
