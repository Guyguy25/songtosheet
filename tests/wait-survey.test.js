'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {QUESTIONS,PER_GENERATION}=require('../lib/wait-survey-questions');
const {nextQuestions}=require('../api/auth/wait-survey');

test('a long, stable list: unique ids, the first three unchanged, 2 to 4 choices each',()=>{
  assert.ok(QUESTIONS.length>=40);
  assert.equal(new Set(QUESTIONS.map(q=>q.id)).size,QUESTIONS.length);
  assert.deepEqual(QUESTIONS.slice(0,3).map(q=>q.id),['level','purpose','source']);
  for(const q of QUESTIONS)assert.ok(Object.keys(q.options).length>=2&&Object.keys(q.options).length<=4,q.id);
});

test('each generation asks the next ones in order, at most four',()=>{
  assert.equal(PER_GENERATION,4);
  assert.deepEqual(nextQuestions({},0).map(q=>q.id),QUESTIONS.slice(0,4).map(q=>q.id));
  // The first three already answered (or skipped): the next generation continues from the 4th.
  const answered={level:'beginner',purpose:null,source:'mix'};
  assert.deepEqual(nextQuestions(answered,0).map(q=>q.id),QUESTIONS.slice(3,7).map(q=>q.id));
  // Two already asked during this generation: only two more.
  assert.equal(nextQuestions(answered,2).length,2);
  assert.equal(nextQuestions(answered,4).length,0);
  // Everything answered: nothing left to ask.
  assert.equal(nextQuestions(Object.fromEntries(QUESTIONS.map(q=>[q.id,null])),0).length,0);
});
