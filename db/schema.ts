import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
const timestamp = (name: string) => text(name).notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), email: text('email').notNull().unique(), displayName: text('display_name'), createdAt: timestamp('created_at'),
});
export const courses = sqliteTable('courses', {
  id: text('id').primaryKey(), owner: text('owner_user_id').notNull().references(() => users.id), name: text('name').notNull(),
  characteristics: text('characteristics').notNull().default(''), preferredMode: text('preferred_mode').notNull().default('detailed_note'),
  createdAt: timestamp('created_at'), updatedAt: timestamp('updated_at'),
}, t => [uniqueIndex('uq_courses_owner_name').on(t.owner, t.name)]);
export const members = sqliteTable('course_members', {
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id), role: text('role').notNull(),
}, t => [primaryKey({ columns: [t.courseId, t.userId] }), check('member_role', sql`${t.role} IN ('owner','editor','viewer')`)]);
export const offerings = sqliteTable('offerings', {
  id: text('id').primaryKey(), courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(), term: text('term').notNull(), professor: text('professor').notNull().default(''),
  section: text('section').notNull().default(''), notes: text('notes').notNull().default(''), createdAt: timestamp('created_at'),
}, t => [uniqueIndex('uq_offerings_class').on(t.courseId, t.year, t.term, t.professor, t.section),
  check('offering_year', sql`${t.year} BETWEEN 1990 AND 2100`), check('offering_term', sql`${t.term} IN ('1','2','여름','겨울')`)]);
export const facts = sqliteTable('course_facts', {
  id: text('id').primaryKey(), courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  offeringId: text('offering_id').references(() => offerings.id), key: text('fact_key').notNull(), value: text('fact_value').notNull(),
  provenance: text('provenance').notNull().default(''), confidence: text('confidence').notNull().default('unknown'), createdAt: timestamp('created_at'),
}, t => [index('idx_facts_course_offering').on(t.courseId, t.offeringId),
  check('fact_confidence', sql`${t.confidence} IN ('official','observed','reported','inferred','unknown')`)]);
export const assets = sqliteTable('source_assets', {
  id: text('id').primaryKey(), offeringId: text('offering_id').notNull().references(() => offerings.id, { onDelete: 'cascade' }),
  type: text('source_type').notNull(), title: text('title').notNull(), filename: text('file_name').notNull().default(''),
  mime: text('mime_type').notNull().default(''), storageKey: text('storage_key'), sha256: text('sha256'),
  extractStatus: text('extract_status').notNull().default('pending'), provenance: text('provenance').notNull().default(''),
  yearReference: integer('year_reference'), weeksJson: text('weeks_json').notNull().default('[]'), createdAt: timestamp('created_at'),
}, t => [index('idx_assets_offering_type').on(t.offeringId, t.type),
  uniqueIndex('uq_assets_content').on(t.offeringId, t.type, t.sha256),
  check('asset_extract_status', sql`${t.extractStatus} IN ('pending','ready','failed','unsupported')`)]);
export const pages = sqliteTable('source_pages', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  pageNum: integer('page_num').notNull(), text: text('text_content').notNull().default(''), verified: integer('verified').notNull().default(0),
}, t => [uniqueIndex('uq_pages_source_page').on(t.sourceId, t.pageNum)]);
export const chunks = sqliteTable('source_chunks', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  pageNum: integer('page_num'), chunkIndex: integer('chunk_index').notNull(), text: text('text_content').notNull(),
}, t => [uniqueIndex('uq_chunks_source_index').on(t.sourceId, t.chunkIndex), index('idx_chunks_source_page').on(t.sourceId, t.pageNum)]);
export const unitMaps = sqliteTable('unit_maps', {
  id: text('id').primaryKey(), offeringId: text('offering_id').notNull().references(() => offerings.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), version: integer('version').notNull().default(1), status: text('status').notNull().default('draft'),
  mappingJson: text('mapping_json').notNull(), updatedAt: timestamp('updated_at'),
}, t => [check('unit_map_json', sql`json_valid(${t.mappingJson})`)]);
export const presets = sqliteTable('production_presets', {
  id: text('id').primaryKey(), courseId: text('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(), version: integer('version').notNull().default(1), settingsJson: text('settings_json').notNull(), createdAt: timestamp('created_at'),
}, t => [check('preset_json', sql`json_valid(${t.settingsJson})`)]);
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(), offeringId: text('offering_id').notNull().references(() => offerings.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), content: text('content_markdown').notNull(), revision: integer('revision').notNull().default(1),
  createdBy: text('created_by_user_id').notNull().references(() => users.id), creationKey: text('creation_key'),
  createdAt: timestamp('created_at'), updatedAt: timestamp('updated_at'),
}, t => [index('idx_notes_offering_updated').on(t.offeringId, t.updatedAt),
  uniqueIndex('uq_notes_creation_request').on(t.offeringId, t.createdBy, t.creationKey)]);
export const versions = sqliteTable('note_versions', {
  noteId: text('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }), revision: integer('revision').notNull(),
  title: text('title').notNull(), content: text('content_markdown').notNull(), sourceRefs: text('source_refs_json').notNull().default('[]'), createdAt: timestamp('created_at'),
}, t => [primaryKey({ columns: [t.noteId, t.revision] }), check('note_refs_json', sql`json_valid(${t.sourceRefs})`)]);
export const packs = sqliteTable('problem_packs', {
  id: text('id').primaryKey(), offeringId: text('offering_id').notNull().references(() => offerings.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), bodyJson: text('body_json').notNull(), createdAt: timestamp('created_at'),
}, t => [check('pack_json', sql`json_valid(${t.bodyJson})`)]);
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(), offeringId: text('offering_id').notNull().references(() => offerings.id, { onDelete: 'cascade' }),
  createdBy: text('created_by_user_id').notNull().references(() => users.id), mode: text('mode').notNull(), scope: text('scope').notNull(),
  status: text('status').notNull().default('pending'), presetVersion: integer('preset_version').notNull().default(1),
  sourceIds: text('source_ids_json').notNull().default('[]'), completedSteps: text('completed_steps_json').notNull().default('[]'), updatedAt: timestamp('updated_at'),
}, t => [check('job_status', sql`${t.status} IN ('pending','partial','needs_review','complete','failed')`),
  check('job_sources_json', sql`json_valid(${t.sourceIds})`), check('job_steps_json', sql`json_valid(${t.completedSteps})`)]);
export const checkpoints = sqliteTable('job_checkpoints', {
  id: text('id').primaryKey(), jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  step: text('step').notNull(), status: text('status').notNull(), resultRef: text('result_ref'), createdAt: timestamp('created_at'),
}, t => [uniqueIndex('uq_checkpoints_job_step').on(t.jobId, t.step)]);
export const attempts = sqliteTable('private_attempts', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  packId: text('pack_id').notNull().references(() => packs.id), dataJson: text('data_json').notNull(), updatedAt: timestamp('updated_at'),
}, t => [check('attempt_json', sql`json_valid(${t.dataJson})`)]);

/** AI-mediated OCR/transcript verification. OCR text is not trusted until each page is reviewed. */
export const sourceReviewPages = sqliteTable('source_review_pages', {
  sourceId: text('source_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  pageNum: integer('page_num').notNull(),
  recognizedText: text('recognized_text').notNull(),
  correctedText: text('corrected_text').notNull(),
  evidenceIds: text('evidence_source_ids_json').notNull().default('[]'),
  unresolved: text('unresolved_json').notNull().default('[]'),
  status: text('review_status').notNull().default('needs_review'),
  updatedAt: timestamp('updated_at'),
}, t => [primaryKey({ columns: [t.sourceId, t.pageNum] }),
  check('source_review_status', sql`${t.status} IN ('needs_review','reviewed')`),
  check('source_review_evidence_json', sql`json_valid(${t.evidenceIds})`),
  check('source_review_unresolved_json', sql`json_valid(${t.unresolved})`)]);
export const aiGenerationRuns = sqliteTable('ai_generation_runs', {
  id: text('id').primaryKey(),
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  offeringId: text('offering_id').notNull().references(() => offerings.id, { onDelete: 'cascade' }),
  createdBy: text('created_by_user_id').notNull().references(() => users.id),
  mode: text('mode').notNull(), scope: text('scope').notNull().default(''),
  sourceIds: text('source_ids_json').notNull().default('[]'),
  status: text('status').notNull().default('awaiting_outline'),
  outline: text('outline_json').notNull().default('[]'),
  noteId: text('note_id').references(() => notes.id),
  updatedAt: timestamp('updated_at'),
}, t => [
  check('ai_run_status', sql`${t.status} IN ('awaiting_outline','outlined','generating','complete','blocked')`),
  check('ai_run_sources_json', sql`json_valid(${t.sourceIds})`),
  check('ai_run_outline_json', sql`json_valid(${t.outline})`),
]);
export const aiGenerationSections = sqliteTable('ai_generation_sections', {
  runId: text('run_id').notNull().references(() => aiGenerationRuns.id, { onDelete: 'cascade' }),
  sectionIndex: integer('section_index').notNull(),
  content: text('content_markdown').notNull(),
  createdAt: timestamp('created_at'),
}, t => [primaryKey({ columns: [t.runId, t.sectionIndex] })]);

export const sourcePageImages = sqliteTable('source_page_images', {
  sourceId: text('source_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  pageNum: integer('page_num').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  updatedAt: timestamp('updated_at'),
}, t => [primaryKey({ columns: [t.sourceId, t.pageNum] })]);

/* v0.9: course-first storage, no offering/professor/year partition in the data model. */
export const courseMaterials = sqliteTable('course_materials', {
 id: text('id').primaryKey(),courseId:text('course_id').notNull().references(()=>courses.id,{onDelete:'cascade'}),
 title:text('title').notNull(),sourceType:text('source_type').notNull(),
 weeksJson:text('weeks_json').notNull().default('[]'),examYear:integer('exam_year'),
 originalFilename:text('original_filename').notNull().default(''),mimeType:text('mime_type').notNull().default(''),
 provenance:text('provenance').notNull().default(''),
 storageKey:text('storage_key'),sha256:text('sha256'),originalText:text('original_text'),
 reviewStatus:text('review_status').notNull().default('pending_review'),
 pageCount:integer('page_count').notNull().default(0),createdAt:timestamp('created_at')
},t=>[uniqueIndex('course_materials_dedupe').on(t.courseId,t.sourceType,t.sha256)]);
export const courseMaterialPages=sqliteTable('course_material_pages',{
 materialId:text('material_id').notNull().references(()=>courseMaterials.id,{onDelete:'cascade'}),
 pageNum:integer('page_num').notNull(),rawText:text('raw_text').notNull(),correctedText:text('corrected_text').notNull(),
 evidenceJson:text('evidence_json').notNull().default('[]'),unresolvedJson:text('unresolved_json').notNull().default('[]')
},t=>[primaryKey({columns:[t.materialId,t.pageNum]})]);
export const courseMaterialPageImages=sqliteTable('course_material_page_images',{
 materialId:text('material_id').notNull().references(()=>courseMaterials.id,{onDelete:'cascade'}),
 pageNum:integer('page_num').notNull(),storageKey:text('storage_key').notNull(),
 mimeType:text('mime_type').notNull(),extractedText:text('extracted_text').notNull().default(''),
 updatedAt:timestamp('updated_at')
},t=>[primaryKey({columns:[t.materialId,t.pageNum]})]);
export const courseDocuments=sqliteTable('course_documents',{
 id:text('id').primaryKey(),courseId:text('course_id').notNull().references(()=>courses.id,{onDelete:'cascade'}),
 type:text('type').notNull().default('study_note'),title:text('title').notNull(),
 content:text('content_markdown').notNull().default(''),revision:integer('revision').notNull().default(1),
 updatedAt:timestamp('updated_at')
});
export const courseDocumentVersions=sqliteTable('course_document_versions',{
 documentId:text('document_id').notNull().references(()=>courseDocuments.id,{onDelete:'cascade'}),
 revision:integer('revision').notNull(),title:text('title').notNull(),
 content:text('content_markdown').notNull(),createdAt:timestamp('created_at')
},t=>[primaryKey({columns:[t.documentId,t.revision]})]);
export const courseProblemPacks=sqliteTable('course_problem_packs',{
 id:text('id').primaryKey(),courseId:text('course_id').notNull().references(()=>courses.id,{onDelete:'cascade'}),
 title:text('title').notNull(),packJson:text('pack_json').notNull(),createdAt:timestamp('created_at')
});
export const courseAttempts=sqliteTable('course_attempts',{
 userId:text('user_id').notNull().references(()=>users.id),
 packId:text('pack_id').notNull().references(()=>courseProblemPacks.id,{onDelete:'cascade'}),
 questionId:text('question_id').notNull(),dataJson:text('data_json').notNull(),updatedAt:timestamp('updated_at')
},t=>[primaryKey({columns:[t.userId,t.packId,t.questionId]})]);
export const courseCasioProjects=sqliteTable('course_casio_projects',{
 id:text('id').primaryKey(),courseId:text('course_id').notNull().references(()=>courses.id,{onDelete:'cascade'}),
 title:text('title').notNull(),blueprintJson:text('blueprint_json').notNull().default('{}'),
 programText:text('program_text').notNull().default(''),manualText:text('manual_text').notNull().default(''),
 updatedAt:timestamp('updated_at')
});
export const courseGenerationJobs=sqliteTable('course_generation_jobs',{
 id:text('id').primaryKey(),courseId:text('course_id').notNull().references(()=>courses.id,{onDelete:'cascade'}),
 userId:text('user_id').notNull().references(()=>users.id),
 mode:text('mode').notNull(),scope:text('scope').notNull().default('전체'),
 sourceIdsJson:text('source_ids_json').notNull().default('[]'),
 outlineJson:text('outline_json').notNull().default('[]'),
 status:text('status').notNull().default('awaiting_outline'),
 documentId:text('document_id').references(()=>courseDocuments.id),
 documentRevision:integer('document_revision').notNull().default(0)
});
export const courseGenerationParts=sqliteTable('course_generation_parts',{
 jobId:text('job_id').notNull().references(()=>courseGenerationJobs.id,{onDelete:'cascade'}),
 sectionIndex:integer('section_index').notNull(),content:text('content_markdown').notNull()
},t=>[primaryKey({columns:[t.jobId,t.sectionIndex]})]);
