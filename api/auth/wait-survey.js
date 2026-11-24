'use strict';
const {database}=require('../../lib/mongodb');
const {authenticated,json}=require('../../lib/session');
const {method,fail}=require('../../lib/authorization');

const {ObjectId}=require('mongodb');
const {QUESTIONS,PER_GENERATION}=require('../../lib/wait-survey-questions');
const {ratingRoute}=require('../../lib/ratings');
const jobId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value)?new ObjectId(value):null;

// The next questions for this generation: in order, never one already answered or skipped,
// and at most PER_GENERATION per generation (counted on the generation itself).
function nextQuestions(answered,asked){
  const room=Math.max(0,PER_GENERATION-asked);
  return QUESTIONS.filter(question=>!Object.hasOwn(answered,question.id)).slice(0,room);
}

module.exports=async(req,res)=>{
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return json(res,405,{detail:'Méthode non autorisée.'});
  }
  if(!method(req,res,req.method))return;
  try{
    const user=await authenticated(req);
    if(!user)return json(res,401,{detail:'Connexion requise.'});
    // /api/auth/rating (note d'une génération au retour) partage cette fonction : limite Vercel atteinte.
    if(req.query?.route==='rating')return ratingRoute(req,res,{db:await database(),user,json});
    const users=(await database()).collection('users');
    const jobs=(await database()).collection('track_jobs');
    if(req.method==='GET'){
      const profile=await users.findOne({_id:user._id},{projection:{wait_survey:1}});
      const job=jobId(req.query?.job);
      const asked=job?(await jobs.findOne({_id:job,user_id:user._id},{projection:{survey_asked:1}}))?.survey_asked||0:0;
      return json(res,200,{questions:nextQuestions(profile?.wait_survey||{},asked)});
    }
    const {id,answer}=req.body||{};
    const question=QUESTIONS.find(item=>item.id===id);
    if(!question||(answer!==null&&(typeof answer!=='string'||!Object.hasOwn(question.options,answer)))){
      return json(res,400,{detail:'Choix invalide.'});
    }
    const field=`wait_survey.${question.id}`;
    const saved=await users.updateOne({_id:user._id,[field]:{$exists:false}},{$set:{[field]:answer}});
    const job=jobId(req.body?.job);
    if(job&&saved.modifiedCount)await jobs.updateOne({_id:job,user_id:user._id},{$inc:{survey_asked:1}});
    return json(res,200,{ok:true});
  }catch(error){return fail(res,error);}
};
module.exports.nextQuestions=nextQuestions;
