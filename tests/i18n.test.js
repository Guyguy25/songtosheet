'use strict';
// Traduction de l'interface en anglais (assets/i18n.js + assets/i18n-en.js), sans navigateur.
const test=require('node:test');
const assert=require('node:assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

function load(){
  const attrs={lang:'fr','data-i18n':'other'};
  const root={getAttribute:n=>attrs[n]??null,setAttribute(n,v){attrs[n]=v;},classList:{add(){},remove(){},toggle(){}}};
  const document={documentElement:root,readyState:'complete',cookie:'',querySelectorAll:()=>[],addEventListener(){}};
  const window={};
  const context={window,document,localStorage:{getItem:()=> 'en',setItem(){}},location:{search:'',hash:''},setTimeout,MutationObserver:function(){}};
  vm.createContext(context);
  for(const file of ['i18n-en.js','i18n.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','assets',file),'utf8'),context);
  return {t:window.TablurioI18n.t,document};
}

test('traduit les textes exacts, les gabarits chiffrés et les phrases assemblées',()=>{
  const {t,document}=load();
  assert.strictEqual(t('Adresse email ou mot de passe incorrect.'),'Incorrect email address or password.');
  assert.strictEqual(t('Tu n’as accès qu’aux 30 premières secondes'),'You only have access to the first 30 seconds');
  assert.strictEqual(t('Ton aperçu couvre 0:30 sur 3:12. Découvre les offres pour accéder au morceau complet.'),
    'Your preview covers 0:30 of 3:12. See the plans to access the full song.');
  assert.strictEqual(t('guitare · Aperçu gratuit · 30 s'),'guitar · Free preview · 30 s');
  assert.strictEqual(t('Tu as utilisé tes 3 aperçus gratuits.'),'You have used your 3 free previews.');
  assert.strictEqual(t('Un texte inconnu.'),'Un texte inconnu.');
  assert.match(document.cookie,/tablurio_lang=en/);
});

test('les emails partent dans la langue du compte',()=>{
  const {TEMPLATES,TEMPLATES_EN,langOf}=require('../lib/email');
  assert.strictEqual(langOf({headers:{cookie:'a=1; tablurio_lang=en'}}),'en');
  assert.strictEqual(langOf({headers:{cookie:'tablurio_lang=fr'}}),'fr');
  assert.strictEqual(langOf({headers:{}}),'fr');
  assert.match(TEMPLATES_EN.verify({code:'123456'}).subject,/your Tablurio code/);
  assert.match(TEMPLATES_EN.ready({title:'Song',url:'https://x'}).html,/lang="en"/);
  assert.match(TEMPLATES.ready({title:'Morceau',url:'https://x'}).html,/lang="fr"/);
});
