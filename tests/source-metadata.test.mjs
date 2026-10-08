import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSourceMetadata} from '../domain/source-metadata.mjs';

test('past exam has year instead of weeks',()=>{
  assert.deepEqual(normalizeSourceMetadata({source_type:'past_exam',exam_year:2024}),{weeks:[],exam_year:2024});
  assert.deepEqual(normalizeSourceMetadata({source_type:'past_exam'}),{weeks:[],exam_year:null});
  assert.throws(()=>normalizeSourceMetadata({source_type:'past_exam',weeks:[2]}),/BAD_REQUEST/);
});
test('ordinary materials can span multiple weeks or be unassigned',()=>{
  assert.deepEqual(normalizeSourceMetadata({source_type:'lecture_slides',weeks:[3,1]}),{weeks:[1,3],exam_year:null});
  assert.deepEqual(normalizeSourceMetadata({source_type:'transcript'}),{weeks:[],exam_year:null});
  for(const weeks of [[0],[31],[1,1],['2'],[1.5]])assert.throws(()=>normalizeSourceMetadata({source_type:'lecture_slides',weeks}),/BAD_REQUEST/);
  assert.throws(()=>normalizeSourceMetadata({source_type:'lecture_slides',exam_year:2020}),/BAD_REQUEST/);
});
