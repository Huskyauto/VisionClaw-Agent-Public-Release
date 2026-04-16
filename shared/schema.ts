import { pgTable, serial, text, timestamp, integer, boolean, jsonb, bigint, real, varchar } from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

const vector = customType<{ data: string }>({
  dataType() {
    return "vector(1536)";
  },
});

export * from "./models/auth";

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  replitUserId: text("replit_user_id").unique(),
  plan: text("plan").notNull().default("trial"),
  trialConversationsUsed: integer("trial_conversations_used").notNull().default(0),
  trialMaxConversations: integer("trial_max_conversations").notNull().default(5),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  stripeConnectEnabled: boolean("stripe_connect_enabled").notNull().default(false),
  stripePaymentMode: text("stripe_payment_mode").notNull().default("none"),
  stripeBYOKSecretKey: text("stripe_byok_secret_key"),
  stripeBYOKPublishableKey: text("stripe_byok_publishable_key"),
  stripeSetupFeePaid: boolean("stripe_setup_fee_paid").notNull().default(false),
  coinbaseCommerceApiKey: text("coinbase_commerce_api_key"),
  coinbaseCdpApiKeyId: text("coinbase_cdp_api_key_id"),
  coinbaseCdpApiKeySecret: text("coinbase_cdp_api_key_secret"),
  coinbaseCommerceWebhookSecret: text("coinbase_commerce_webhook_secret"),
  agentmailInboxId: text("agentmail_inbox_id"),
  agentmailEmail: text("agentmail_email"),
  publicChatToken: text("public_chat_token").unique(),
  publicChatEnabled: boolean("public_chat_enabled").notNull().default(false),
  vanitySlug: text("vanity_slug").unique(),
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: boolean("email_verified").default(false),
  onboardingSeen: boolean("onboarding_seen").notNull().default(false),
  deletionScheduledAt: timestamp("deletion_scheduled_at"),
  accountStatus: text("account_status"),
  whatsappApprovalPhone: text("whatsapp_approval_phone"),
  isAdmin: boolean("is_admin").notNull().default(false),
  driveFolderId: text("drive_folder_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true, trialConversationsUsed: true, emailVerified: true });
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default("Personal Assistant"),
  icon: text("icon").notNull().default("Bot"),
  isActive: boolean("is_active").notNull().default(false),
  soul: text("soul").notNull().default(""),
  identity: text("identity").notNull().default(""),
  memoryDoc: text("memory_doc").notNull().default(""),
  operatingLoop: text("operating_loop").notNull().default(""),
  heartbeatDoc: text("heartbeat_doc").notNull().default(""),
  toolsDoc: text("tools_doc").notNull().default(""),
  agentsDoc: text("agents_doc").notNull().default(""),
  brandVoiceDoc: text("brand_voice_doc").notNull().default(""),
  costTier: text("cost_tier").notNull().default("balanced"),
  reasoningConfig: jsonb("reasoning_config"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tenantPersonaNames = pgTable("tenant_persona_names", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  personaId: integer("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
});

export type TenantPersonaName = typeof tenantPersonaNames.$inferSelect;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("New Chat"),
  model: text("model").notNull().default("gpt-5.1"),
  thinking: boolean("thinking").notNull().default(false),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  publicToken: text("public_token"),
  projectId: integer("project_id"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const memoryEntries = pgTable("memory_entries", {
  id: serial("id").primaryKey(),
  fact: text("fact").notNull(),
  category: text("category").notNull().default("preference"),
  source: text("source").notNull().default("conversation"),
  status: text("status").notNull().default("active"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  accessCount: integer("access_count").notNull().default(0),
  categoryId: integer("category_id"),
  wing: text("wing"),
  room: text("room"),
  embedding: jsonb("embedding"),
  embeddingVec: vector("embedding_vec"),
  expiresAt: timestamp("expires_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastAccessed: timestamp("last_accessed").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const dailyNotes = pgTable("daily_notes", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  content: text("content").notNull(),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const agentSettings = pgTable("agent_settings", {
  id: serial("id").primaryKey(),
  agentName: text("agent_name").notNull().default("VisionClaw"),
  personality: text("personality").notNull().default("You are VisionClaw, a helpful personal AI assistant."),
  defaultModel: text("default_model").notNull().default("gpt-5.1"),
  thinkingEnabled: boolean("thinking_enabled").notNull().default(false),
  discordBotToken: text("discord_bot_token"),
  accessPin: text("access_pin"),
  whatsappApprovalPhone: text("whatsapp_approval_phone"),
  telegramBotToken: text("telegram_bot_token"),
});

export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull().default("Zap"),
  enabled: boolean("enabled").notNull().default(true),
  category: text("category").notNull().default("general"),
  promptContent: text("prompt_content"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
});

export const agentActivity = pgTable("agent_activity", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  personaId: integer("persona_id").references(() => personas.id),
  personaName: text("persona_name").notNull().default("VisionClaw"),
  status: text("status").notNull().default("idle"),
  activityType: text("activity_type").notNull().default("chat"),
  summary: text("summary"),
  conversationId: integer("conversation_id").references(() => conversations.id),
  metadata: jsonb("metadata").default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const providerKeys = pgTable("provider_keys", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  apiKey: text("api_key").notNull(),
  baseUrl: text("base_url"),
  enabled: boolean("enabled").notNull().default(true),
});

export const agentKnowledge = pgTable("agent_knowledge", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull().default("insight"),
  priority: integer("priority").notNull().default(3),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  source: text("source").notNull().default("user"),
  embedding: jsonb("embedding"),
  embeddingVec: vector("embedding_vec"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const heartbeatTasks = pgTable("heartbeat_tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull().default("routine"),
  cronExpression: text("cron_expression").notNull().default("*/30 * * * *"),
  enabled: boolean("enabled").notNull().default(true),
  promptContent: text("prompt_content").notNull(),
  model: text("model").notNull().default("gpt-5-nano"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  createdBy: text("created_by").notNull().default("user"),
  parentTaskId: integer("parent_task_id"),
  runOnce: boolean("run_once").notNull().default(false),
  tenantId: integer("tenant_id").notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  approvalStatus: text("approval_status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const heartbeatLogs = pgTable("heartbeat_logs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id"),
  taskName: text("task_name").notNull(),
  status: text("status").notNull().default("success"),
  input: text("input"),
  output: text("output"),
  model: text("model"),
  personaId: integer("persona_id"),
  personaName: text("persona_name"),
  delegatedTasks: text("delegated_tasks"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPersonaSchema = createInsertSchema(personas).omit({ id: true, createdAt: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertMemoryEntrySchema = createInsertSchema(memoryEntries).omit({ id: true, createdAt: true, lastAccessed: true });
export const insertDailyNoteSchema = createInsertSchema(dailyNotes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSettingsSchema = createInsertSchema(agentSettings).omit({ id: true });
export const insertSkillSchema = createInsertSchema(skills).omit({ id: true });
export const insertProviderKeySchema = createInsertSchema(providerKeys).omit({ id: true });
export const insertKnowledgeSchema = createInsertSchema(agentKnowledge).omit({ id: true, createdAt: true, updatedAt: true });
export const insertHeartbeatTaskSchema = createInsertSchema(heartbeatTasks).omit({ id: true, createdAt: true, lastRunAt: true, nextRunAt: true });
export const insertHeartbeatLogSchema = createInsertSchema(heartbeatLogs).omit({ id: true, createdAt: true });

export const conversationTemplates = pgTable("conversation_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull().default("MessageSquare"),
  category: text("category").notNull().default("general"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  model: text("model"),
  systemPromptPrefix: text("system_prompt_prefix"),
  starterMessages: text("starter_messages").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConversationTemplateSchema = createInsertSchema(conversationTemplates).omit({ id: true, createdAt: true });

export const memoryCategories = pgTable("memory_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  description: text("description"),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  memoryCount: integer("memory_count").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const memoryLinks = pgTable("memory_links", {
  id: serial("id").primaryKey(),
  sourceMemoryId: integer("source_memory_id").notNull().references(() => memoryEntries.id, { onDelete: "cascade" }),
  targetMemoryId: integer("target_memory_id").notNull().references(() => memoryEntries.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull().default("related"),
  strength: real("strength").notNull().default(0.5),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertMemoryCategorySchema = createInsertSchema(memoryCategories).omit({ id: true, createdAt: true });
export const insertMemoryLinkSchema = createInsertSchema(memoryLinks).omit({ id: true, createdAt: true });

export type MemoryCategory = typeof memoryCategories.$inferSelect;
export type InsertMemoryCategory = z.infer<typeof insertMemoryCategorySchema>;
export type MemoryLink = typeof memoryLinks.$inferSelect;
export type InsertMemoryLink = z.infer<typeof insertMemoryLinkSchema>;

export type Persona = typeof personas.$inferSelect;
export type InsertPersona = z.infer<typeof insertPersonaSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type MemoryEntry = typeof memoryEntries.$inferSelect;
export type InsertMemoryEntry = z.infer<typeof insertMemoryEntrySchema>;
export type DailyNote = typeof dailyNotes.$inferSelect;
export type InsertDailyNote = z.infer<typeof insertDailyNoteSchema>;
export type AgentSettings = typeof agentSettings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Skill = typeof skills.$inferSelect;
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type ProviderKey = typeof providerKeys.$inferSelect;
export type InsertProviderKey = z.infer<typeof insertProviderKeySchema>;
export type AgentKnowledge = typeof agentKnowledge.$inferSelect;
export type InsertKnowledge = z.infer<typeof insertKnowledgeSchema>;
export type HeartbeatTask = typeof heartbeatTasks.$inferSelect;
export type InsertHeartbeatTask = z.infer<typeof insertHeartbeatTaskSchema>;
export type HeartbeatLog = typeof heartbeatLogs.$inferSelect;
export type InsertHeartbeatLog = z.infer<typeof insertHeartbeatLogSchema>;
export type ConversationTemplate = typeof conversationTemplates.$inferSelect;
export type InsertConversationTemplate = z.infer<typeof insertConversationTemplateSchema>;

export const customTools = pgTable("custom_tools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  parameters: jsonb("parameters").notNull().default("[]"),
  implementation: text("implementation").notNull(),
  createdBy: text("created_by").notNull().default("agent"),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCustomToolSchema = createInsertSchema(customTools).omit({ id: true, usageCount: true, createdAt: true });
export type CustomTool = typeof customTools.$inferSelect;
export type InsertCustomTool = z.infer<typeof insertCustomToolSchema>;

export const experiments = pgTable("experiments", {
  id: serial("id").primaryKey(),
  hypothesis: text("hypothesis").notNull(),
  approach: text("approach").notNull(),
  category: text("category").notNull().default("general"),
  metric: text("metric"),
  baselineValue: text("baseline_value"),
  resultValue: text("result_value"),
  status: text("status").notNull().default("running"),
  outcome: text("outcome"),
  personaId: integer("persona_id"),
  tenantId: integer("tenant_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertExperimentSchema = createInsertSchema(experiments).omit({ id: true, createdAt: true });
export type Experiment = typeof experiments.$inferSelect;
export type InsertExperiment = z.infer<typeof insertExperimentSchema>;

export const fileStorage = pgTable("file_storage", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull().default(""),
  storageKey: text("storage_key"),
  driveUrl: text("drive_url"),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertFileStorageSchema = createInsertSchema(fileStorage).omit({ id: true, createdAt: true });
export type FileStorageEntry = typeof fileStorage.$inferSelect;
export type InsertFileStorageEntry = z.infer<typeof insertFileStorageSchema>;

export const deliveryLogs = pgTable("delivery_logs", {
  id: serial("id").primaryKey(),
  orderId: text("order_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  productName: text("product_name").notNull(),
  fileName: text("file_name").notNull(),
  driveFileId: text("drive_file_id"),
  driveFolderId: text("drive_folder_id"),
  folderLink: text("folder_link"),
  downloadLink: text("download_link"),
  shareableLink: text("shareable_link"),
  emailSent: boolean("email_sent").default(false),
  emailMessageId: text("email_message_id"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  stripePaymentId: text("stripe_payment_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertDeliveryLogSchema = createInsertSchema(deliveryLogs).omit({ id: true, createdAt: true, completedAt: true });
export type DeliveryLog = typeof deliveryLogs.$inferSelect;
export type InsertDeliveryLog = z.infer<typeof insertDeliveryLogSchema>;


export const authSessions = pgTable("auth_sessions", {
  token: text("token").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

export const compactionArchives = pgTable("compaction_archives", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  archivedAt: timestamp("archived_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  messageCount: integer("message_count").notNull().default(0),
  totalMessages: integer("total_messages").notNull().default(0),
  content: text("content").notNull(),
  summary: text("summary"),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  primaryConversationId: integer("primary_conversation_id"),
  tenantId: integer("tenant_id").notNull(),
  driveFolderId: text("drive_folder_id"),
  driveFolderUrl: text("drive_folder_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projectNotes = pgTable("project_notes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  note: text("note").notNull(),
  author: text("author").default("system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path"),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  uploadedBy: text("uploaded_by").default("system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projectConversations = pgTable("project_conversations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const docCollections = pgTable("doc_collections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const docChunks = pgTable("doc_chunks", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull(),
  docPath: text("doc_path").notNull(),
  docTitle: text("doc_title").notNull(),
  chunkIndex: integer("chunk_index").notNull().default(0),
  content: text("content").notNull(),
  context: text("context").default(""),
  embedding: jsonb("embedding"),
  tokenCount: integer("token_count").default(0),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const briefingReports = pgTable("briefing_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  content: text("content").notNull(),
  generatedBy: text("generated_by").default("ai"),
  model: text("model"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const briefingWidgets = pgTable("briefing_widgets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  widgetType: text("widget_type").notNull().default("custom"),
  label: text("label").notNull(),
  prompt: text("prompt").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  lastValue: text("last_value"),
  lastUpdatedAt: timestamp("last_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usageTracking = pgTable("usage_tracking", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  metric: text("metric").notNull(),
  count: integer("count").notNull().default(0),
  period: text("period").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const emailVerificationCodes = pgTable("email_verification_codes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).default(sql`(EXTRACT(EPOCH FROM NOW()) * 1000)`),
});

export const researchPrograms = pgTable("research_programs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  constraints: text("constraints").notNull().default(""),
  metrics: text("metrics").notNull().default(""),
  explorationStrategy: text("exploration_strategy").notNull().default("balanced"),
  model: text("model").default("deepseek/deepseek-v3.2"),
  maxExperimentsPerSession: integer("max_experiments_per_session").default(20),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const researchSessions = pgTable("research_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  totalExperiments: integer("total_experiments").default(0),
  experimentsKept: integer("experiments_kept").default(0),
  experimentsDiscarded: integer("experiments_discarded").default(0),
  experimentsCrashed: integer("experiments_crashed").default(0),
  totalTokensUsed: integer("total_tokens_used").default(0),
  summary: text("summary"),
  model: text("model"),
});

export const researchExperiments = pgTable("research_experiments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id").notNull(),
  hypothesis: text("hypothesis").notNull(),
  approach: text("approach").notNull().default(""),
  result: text("result"),
  metric: text("metric"),
  metricValue: text("metric_value"),
  status: text("status").notNull().default("running"),
  parentExperimentId: integer("parent_experiment_id"),
  tokensUsed: integer("tokens_used").default(0),
  durationMs: integer("duration_ms"),
  model: text("model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const researchSchedules = pgTable("research_schedules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id"),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull().default("0 2 * * *"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  runAll: boolean("run_all").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiInsights = pgTable("ai_insights", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  engineType: text("engine_type").notNull(),
  category: text("category").notNull().default("general"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("new"),
  dataSnapshot: text("data_snapshot"),
  actionTaken: text("action_taken"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  token: text("token").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  email: text("email").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).default(sql`(EXTRACT(EPOCH FROM NOW()) * 1000)`),
});

export const whatsappAuth = pgTable("whatsapp_auth", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const governanceActions = pgTable("governance_actions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  ruleId: integer("rule_id"),
  ruleName: text("rule_name"),
  category: text("category"),
  conditionMet: text("condition_met"),
  actionTaken: text("action_taken"),
  actionDetail: jsonb("action_detail"),
  escalated: boolean("escalated").default(false),
  escalationStatus: text("escalation_status"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const governanceRules = pgTable("governance_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  category: text("category").notNull(),
  ruleName: text("rule_name").notNull(),
  description: text("description").notNull(),
  condition: jsonb("condition").notNull(),
  action: text("action").notNull(),
  actionConfig: jsonb("action_config").notNull().default({}),
  escalateToHuman: boolean("escalate_to_human").notNull().default(false),
  escalationReason: text("escalation_reason"),
  priority: integer("priority").notNull().default(5),
  enabled: boolean("enabled").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  triggerCount: integer("trigger_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const governanceFrameworks = pgTable("governance_frameworks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  organization: text("organization").notNull(),
  version: text("version").notNull(),
  sourceUrl: text("source_url"),
  category: text("category").notNull(),
  description: text("description").notNull(),
  keyPrinciples: jsonb("key_principles").notNull().default([]),
  rulesInformed: jsonb("rules_informed").notNull().default([]),
  lastReviewed: timestamp("last_reviewed", { withTimezone: true }).defaultNow().notNull(),
  nextReviewDate: timestamp("next_review_date", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const actionOutcomes = pgTable("action_outcomes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  actionType: text("action_type").notNull(),
  actionRef: text("action_ref"),
  actionDescription: text("action_description").notNull(),
  actionTimestamp: timestamp("action_timestamp").defaultNow().notNull(),
  expectedOutcome: text("expected_outcome"),
  expectedMetric: text("expected_metric"),
  expectedValue: real("expected_value"),
  actualOutcome: text("actual_outcome"),
  actualValue: real("actual_value"),
  outcomeStatus: text("outcome_status").default("pending"),
  measuredAt: timestamp("measured_at"),
  feedbackSummary: text("feedback_summary"),
  feedbackApplied: boolean("feedback_applied").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const outcomePatterns = pgTable("outcome_patterns", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  actionType: text("action_type").notNull(),
  pattern: text("pattern").notNull(),
  evidence: jsonb("evidence"),
  confidenceScore: real("confidence_score"),
  recommendation: text("recommendation"),
  sampleSize: integer("sample_size"),
  discoveredAt: timestamp("discovered_at").defaultNow(),
  lastValidated: timestamp("last_validated"),
});

export const agentChannels = pgTable("agent_channels", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").default("topic"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const channelMessages = pgTable("channel_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  channelId: integer("channel_id").notNull(),
  fromPersonaId: integer("from_persona_id"),
  messageType: text("message_type").default("message"),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  threadId: integer("thread_id"),
  readBy: jsonb("read_by").default([]),
  eventRef: integer("event_ref"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const channelSubscriptions = pgTable("channel_subscriptions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  channelId: integer("channel_id").notNull(),
  personaId: integer("persona_id").notNull(),
  priority: text("priority").default("normal"),
  filter: jsonb("filter"),
  enabled: boolean("enabled").default(true),
});

export const agentDesks = pgTable("agent_desks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  activeTasks: jsonb("active_tasks").default([]),
  blockedItems: jsonb("blocked_items").default([]),
  waitingFor: jsonb("waiting_for").default([]),
  queue: jsonb("queue").default([]),
  recentCompletions: jsonb("recent_completions").default([]),
  focusArea: text("focus_area"),
  statusNote: text("status_note"),
  lastActiveAt: timestamp("last_active_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const eventLog = pgTable("event_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  data: jsonb("data"),
  status: text("status").default("pending"),
  processingResult: jsonb("processing_result"),
  processedBy: integer("processed_by"),
  processedAt: timestamp("processed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const eventSubscriptions = pgTable("event_subscriptions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  eventType: text("event_type").notNull(),
  personaId: integer("persona_id").notNull(),
  action: text("action").default("process"),
  priority: integer("priority").default(5),
  actionConfig: jsonb("action_config"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const autonomyRules = pgTable("autonomy_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  actionType: text("action_type").notNull(),
  autonomyLevel: text("autonomy_level").notNull().default("approve_before"),
  conditions: jsonb("conditions"),
  maxValue: real("max_value"),
  requiresConfidenceScore: real("requires_confidence_score"),
  escalateTo: text("escalate_to"),
  description: text("description"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const autonomyLog = pgTable("autonomy_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  actionType: text("action_type").notNull(),
  decision: text("decision").notNull(),
  ruleId: integer("rule_id"),
  confidenceScore: real("confidence_score"),
  context: jsonb("context"),
  escalatedTo: text("escalated_to"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  createdByPersonaId: integer("created_by_persona_id"),
  name: text("name").notNull(),
  category: text("category").notNull().default("competitor"),
  searchQueries: jsonb("search_queries").notNull().default([]),
  keywords: jsonb("keywords"),
  checkFrequency: text("check_frequency").default("daily"),
  lastCheckedAt: timestamp("last_checked_at"),
  lastResults: jsonb("last_results"),
  alertThreshold: text("alert_threshold").default("any_new"),
  escalateToPersonaId: integer("escalate_to_persona_id"),
  enabled: boolean("enabled").default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const watchlistAlerts = pgTable("watchlist_alerts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  watchlistItemId: integer("watchlist_item_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  source: text("source"),
  severity: text("severity").default("info"),
  matchedKeywords: jsonb("matched_keywords"),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedByPersonaId: integer("acknowledged_by_persona_id"),
  processedByEvent: integer("processed_by_event"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const oauthSubscriptions = pgTable("oauth_subscriptions", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  tenantId: integer("tenant_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: bigint("expires_at", { mode: "number" }),
  accountId: text("account_id"),
  email: text("email"),
  scope: text("scope"),
  tokenType: text("token_type"),
  pkceState: text("pkce_state"),
  pkceVerifier: text("pkce_verifier"),
  connectedAt: timestamp("connected_at"),
  lastRefreshed: timestamp("last_refreshed"),
  isActive: boolean("is_active"),
  consecutiveFailures: integer("consecutive_failures"),
});

export const tenantProviderKeys = pgTable("tenant_provider_keys", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  provider: text("provider").notNull(),
  apiKey: text("api_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  label: text("label"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  lastVerifiedAt: timestamp("last_verified_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const mcpServers = pgTable("mcp_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  serverUrl: text("server_url").notNull(),
  authType: text("auth_type").default("none"),
  authToken: text("auth_token"),
  enabled: boolean("enabled").default(true),
  toolCount: integer("tool_count").default(0),
  lastConnected: timestamp("last_connected", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const modelRegistryUpdates = pgTable("model_registry_updates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  updateType: text("update_type").notNull(),
  modelId: text("model_id").notNull(),
  modelData: jsonb("model_data"),
  status: text("status").notNull().default("pending"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scrapedPages = pgTable("scraped_pages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  contentLength: integer("content_length").notNull().default(0),
  crawlJobId: text("crawl_job_id"),
  tags: text("tags").array(),
  metadata: jsonb("metadata"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
});

export const personalityFiles = pgTable("personality_files", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  fileType: text("file_type").notNull(),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const trustScores = pgTable("trust_scores", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  category: text("category").notNull(),
  score: integer("score").notNull().default(50),
  autonomyLevel: text("autonomy_level").notNull().default("approve_before"),
  lastChangeReason: text("last_change_reason"),
  lastChangeAmount: integer("last_change_amount").default(0),
  consecutiveDaysAbove: integer("consecutive_days_above").default(0),
  locked: boolean("locked").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type TrustScore = typeof trustScores.$inferSelect;

export const proactiveActions = pgTable("proactive_actions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  triggerCondition: text("trigger_condition").notNull(),
  actionTaken: text("action_taken").notNull(),
  pabCost: integer("pab_cost").notNull().default(1),
  outcome: text("outcome").default("pending"),
  trustImpact: integer("trust_impact").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ProactiveAction = typeof proactiveActions.$inferSelect;

export const expressLaneUsage = pgTable("express_lane_usage", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  laneId: text("lane_id").notNull(),
  fromPersonaId: integer("from_persona_id").notNull(),
  toPersonaId: integer("to_persona_id").notNull(),
  workType: text("work_type").notNull(),
  success: boolean("success"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ExpressLaneUsage = typeof expressLaneUsage.$inferSelect;

export const evaluatorSnapshots = pgTable("evaluator_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  evaluatorName: text("evaluator_name").notNull(),
  metrics: jsonb("metrics").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type EvaluatorSnapshot = typeof evaluatorSnapshots.$inferSelect;

export const sentimentEvents = pgTable("sentiment_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  frustration: boolean("frustration").default(false),
  urgency: boolean("urgency").default(false),
  confusion: boolean("confusion").default(false),
  satisfaction: boolean("satisfaction").default(false),
  score: integer("score").default(0),
  triggers: text("triggers"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type SentimentEvent = typeof sentimentEvents.$inferSelect;

export const consolidationLog = pgTable("consolidation_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  reviewed: integer("reviewed").default(0),
  merged: integer("merged").default(0),
  archived: integer("archived").default(0),
  promoted: integer("promoted").default(0),
  created: integer("created").default(0),
  errors: integer("errors").default(0),
  summary: text("summary"),
  durationMs: integer("duration_ms").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ConsolidationLog = typeof consolidationLog.$inferSelect;

export const presenterSessions = pgTable("presenter_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  presentationId: text("presentation_id").notNull(),
  title: text("title").notNull(),
  slides: jsonb("slides").notNull().default([]),
  embedUrl: text("embed_url").notNull(),
  presentUrl: text("present_url").notNull(),
  token: text("token").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});
export type PresenterSession = typeof presenterSessions.$inferSelect;

export const inboxMessages = pgTable("inbox_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  messageId: varchar("message_id", { length: 255 }).notNull().unique(),
  inboxId: varchar("inbox_id", { length: 255 }).notNull(),
  fromAddress: text("from_address").notNull().default(""),
  toAddress: text("to_address").notNull().default(""),
  subject: text("subject").notNull().default("(No Subject)"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  direction: varchar("direction", { length: 10 }).notNull().default("inbound"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  isRead: boolean("is_read").notNull().default(false),
  isStarred: boolean("is_starred").notNull().default(false),
  threadId: varchar("thread_id", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type InboxMessage = typeof inboxMessages.$inferSelect;

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  type: varchar("type", { length: 50 }).notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  category: varchar("category", { length: 50 }).notNull().default("system"),
  isRead: boolean("is_read").notNull().default(false),
  actionUrl: text("action_url"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Notification = typeof notifications.$inferSelect;
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  actorType: varchar("actor_type", { length: 30 }).notNull().default("agent"),
  actorName: varchar("actor_name", { length: 100 }).notNull().default("System"),
  action: varchar("action", { length: 100 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }),
  resourceId: varchar("resource_id", { length: 100 }),
  description: text("description").notNull().default(""),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ActivityLogEntry = typeof activityLog.$inferSelect;
export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true, createdAt: true });
export type InsertActivityLogEntry = z.infer<typeof insertActivityLogSchema>;

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  role: varchar("role", { length: 30 }).notNull().default("viewer"),
  status: varchar("status", { length: 30 }).notNull().default("invited"),
  invitedBy: integer("invited_by"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
});
export type TeamMember = typeof teamMembers.$inferSelect;
export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ id: true, invitedAt: true, joinedAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ApiKey = typeof apiKeys.$inferSelect;
export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;

export const researchEvidence = pgTable("research_evidence", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  projectId: integer("project_id"),
  query: text("query").notNull(),
  claim: text("claim").notNull(),
  sourceUrl: text("source_url"),
  sourceTitle: text("source_title"),
  sourceDate: text("source_date"),
  theme: text("theme"),
  confidence: integer("confidence").notNull().default(70),
  supportingQuote: text("supporting_quote"),
  contradicts: text("contradicts"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitorRegistry = pgTable("competitor_registry", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  website: text("website").notNull(),
  pricingUrl: text("pricing_url"),
  productUrl: text("product_url"),
  changelogUrl: text("changelog_url"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitorSnapshots = pgTable("competitor_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  competitorId: integer("competitor_id").notNull(),
  url: text("url").notNull(),
  contentHash: text("content_hash"),
  contentText: text("content_text"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitorChanges = pgTable("competitor_changes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  competitorId: integer("competitor_id").notNull(),
  snapshotId: integer("snapshot_id").notNull(),
  changeType: text("change_type").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  significance: text("significance").notNull().default("medium"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leadScoringRules = pgTable("lead_scoring_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  icpDescription: text("icp_description").notNull(),
  criteria: text("criteria").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leadEnrichments = pgTable("lead_enrichments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  leadName: text("lead_name").notNull(),
  leadEmail: text("lead_email"),
  companyName: text("company_name"),
  companyUrl: text("company_url"),
  companyDescription: text("company_description"),
  industry: text("industry"),
  companySize: text("company_size"),
  role: text("role"),
  enrichmentData: text("enrichment_data"),
  icpScore: integer("icp_score"),
  icpGrade: text("icp_grade"),
  qualificationStatus: text("qualification_status").notNull().default("unscored"),
  stage: text("stage").notNull().default("new"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const outreachSequences = pgTable("outreach_sequences", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const outreachSequenceSteps = pgTable("outreach_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull(),
  stepNumber: integer("step_number").notNull(),
  channel: text("channel").notNull().default("email"),
  subject: text("subject"),
  bodyTemplate: text("body_template").notNull(),
  waitDays: integer("wait_days").notNull().default(3),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const outreachEnrollments = pgTable("outreach_enrollments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  sequenceId: integer("sequence_id").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  companyName: text("company_name"),
  currentStep: integer("current_step").notNull().default(1),
  status: text("status").notNull().default("active"),
  lastSentAt: timestamp("last_sent_at"),
  nextSendAt: timestamp("next_send_at"),
  replyClassification: text("reply_classification"),
  replyContent: text("reply_content"),
  personalContext: text("personal_context"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
