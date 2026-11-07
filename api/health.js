'use strict';
const {database}=require('../lib/mongodb');
const {ensureIndexes}=require('../lib/generations');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({status:'method_not_allowed'});}
  try{
    const db=await database();
    await db.command({ping:1});
    await ensureIndexes(db);
    return res.status(200).json({status:'ok'});
  }catch(error){
    return res.status(503).json({status:'unavailable'});
  }
};
