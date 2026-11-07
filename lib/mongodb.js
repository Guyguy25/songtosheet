'use strict';
const {MongoClient}=require('mongodb');
let connectionPromise=null;
function configured(){return Boolean(process.env.MONGODB_URI);}
async function database(){
  if(!configured())throw new Error('MongoDB n’est pas configuré.');
  if(!connectionPromise){
    const client=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:8,serverSelectionTimeoutMS:7000,connectTimeoutMS:7000});
    connectionPromise=client.connect().then(()=>client).catch(error=>{connectionPromise=null;throw error;});
  }
  return (await connectionPromise).db(process.env.MONGODB_DB_NAME||'songtosheet');
}
module.exports={database,configured};
