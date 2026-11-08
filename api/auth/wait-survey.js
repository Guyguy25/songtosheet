'use strict';
const {database}=require('../../lib/mongodb');
const {authenticated,json}=require('../../lib/session');
const {method,fail}=require('../../lib/authorization');

const questions=[
  {id:'level',text:'Comment décrirais-tu ton niveau ?',options:{
    beginner:'Je débute',intermediate:'Je joue déjà régulièrement',advanced:'Je suis à l’aise',professional:'La musique est mon métier'
  }},
  {id:'purpose',text:'À quoi te servirait surtout la transcription ?',options:{
    learn:'Apprendre un morceau',practice:'Travailler un passage',teach:'Préparer un cours',create:'Composer ou arranger'
  }},
  {id:'source',text:'Quel type d’audio veux-tu transcrire le plus souvent ?',options:{
    solo:'Un instrument seul',mix:'Des morceaux avec plusieurs instruments',voice:'Des morceaux avec du chant',own:'Mes propres enregistrements'
  }}
];

module.exports=async(req,res)=>{
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return json(res,405,{detail:'Méthode non autorisée.'});
  }
  if(!method(req,res,req.method))return;
  try{
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connexion requise.'});
    const users=(await database()).collection('users');
    if(req.method==='GET'){
      const profile=await users.findOne({_id:user._id},{projection:{wait_survey:1}});
      const answered=profile?.wait_survey||{};
      return json(res,200,{questions:questions.filter(question=>!Object.hasOwn(answered,question.id))});
    }
    const {id,answer}=req.body||{};
    const question=questions.find(item=>item.id===id);
    if(!question||(answer!==null&&(typeof answer!=='string'||!Object.hasOwn(question.options,answer)))){
      return json(res,400,{detail:'Choix invalide.'});
    }
    const field=`wait_survey.${question.id}`;
    await users.updateOne({_id:user._id,[field]:{$exists:false}},{$set:{[field]:answer}});
    return json(res,200,{ok:true});
  }catch(error){return fail(res,error);}
};
