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
