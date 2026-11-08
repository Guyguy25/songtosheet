'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {method}=require('../lib/authorization');
const {json}=require('../lib/session');

const scripts={
  score:[require.resolve('opensheetmusicdisplay'),path.join(path.dirname(require.resolve('opensheetmusicdisplay/package.json')),'LICENSE')],
  midi:[require.resolve('@tonejs/midi'),path.join(path.dirname(require.resolve('@tonejs/midi/package.json')),'LICENSE.md')]
};

module.exports=(req,res)=>{
  if(!method(req,res,'GET'))return;
  const asset=req.query?.asset;
  if(!Object.hasOwn(scripts,asset))return json(res,404,{detail:'Ressource introuvable.'});
  res.setHeader('Content-Type','application/javascript; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=31536000, immutable');
  const [script,license]=scripts[asset];
  const notice=fs.readFileSync(license,'utf8').replaceAll('*/','* /');
  return res.status(200).send(`/*!\n${notice}\n*/\n${fs.readFileSync(script,'utf8')}`);
};
