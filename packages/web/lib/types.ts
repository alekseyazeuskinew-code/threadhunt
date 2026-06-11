// Типы ответов API для дашборда (узкие, под нужды UI).

export interface Keyword {
  id?: string;
  text: string;
  mode: string;
  replyText?: string | null;
}

export interface ReplyTemplate {
  id?: string;
  text: string;
  redirectTarget: string;
}

export interface MediaItem {
  url: string;
  type: 'image' | 'video';
}

// Один сегмент цепочки: текст + карусель медиа. segment[0] — корневой пост,
// остальные — ветки-ответы.
export interface PostSegment {
  text: string;
  media: MediaItem[];
}

export interface PostTemplate {
  id?: string;
  text: string;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | null;
  segmentsJson?: string | null; // JSON массива сегментов (карусель + цепочка)
}

export interface DmStats {
  lastPass: { scanned: number; sent: number; matched: number; sections: string | null; at: string } | null;
  byKeyword: { keyword: string; count: number }[];
  agent: { online: boolean; threadsLoggedIn: boolean; lastHeartbeat: string | null };
  runNowAt: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'update' | 'important';
  published?: boolean;
  createdAt: string;
}

export interface CompanyProfile {
  name: string;
  niche?: string;
  about?: string;
  perks?: string;
  social?: string;
}

export interface ResearchPostRow {
  id: string;
  text: string;
  author: string | null;
  permalink: string | null;
  likes: number;
  replies: number;
  reposts: number;
  score: number;
  postedAt: string | null;
}

export interface ActivityItem {
  kind: 'post' | 'lead' | 'pass';
  at: string;
  ok: boolean;
  title: string;
  detail?: string;
  permalink?: string | null;
}

export interface PublishConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxPerDay: number;
  rotation: 'sequential' | 'random';
}

export interface SearchSummary {
  id: string;
  title: string;
  description: string;
  status: 'ACTIVE' | 'PAUSED';
  keywords: Keyword[];
  publishConfig: PublishConfig | null;
  connection?: { username: string } | null;
  _count: { leads: number; publishedPosts: number };
}

export interface SearchDetail extends SearchSummary {
  replyTemplates: ReplyTemplate[];
  postTemplates: PostTemplate[];
  connection?: { id: string; username: string } | null;
  obEnabled: boolean;
  obConditions: string;
  obTestTask: string;
  obNda: string;
  obFlow?: string | null;
  obDeadlineMode?: 'none' | 'relative' | 'fixed';
  obDeadlineHours?: number;
  obDeadlineAt?: string | null;
  obTimezone?: string;
  obRemindersEnabled?: boolean;
  commentRule?: CommentRuleConfig | null;
}

export interface CommentRuleConfig {
  enabled: boolean;
  mode: 'keyword' | 'all';
  replyText: string;
}

export type Stage = 'NEW' | 'CONTACTED' | 'SCREENING' | 'HIRED' | 'BENCH' | 'REJECTED';

export interface Lead {
  id: string;
  searchId?: string;
  fromUsername: string | null;
  matchedKeyword: string;
  section: string | null;
  status: 'REPLIED' | 'FAILED' | 'MANUAL';
  stage: Stage;
  rating: number;
  createdAt: string;
  search?: { title: string };
  _count?: { comments: number };
  // поля жизненного цикла
  contact?: string | null;
  conditionsSentAt?: string | null;
  testSentAt?: string | null;
  testDeadlineAt?: string | null;
  testSubmittedUrl?: string | null;
  testSubmittedAt?: string | null;
  decisionReason?: string | null;
  role?: string | null;
  rate?: string | null;
  startedAt?: string | null;
  nextTouchAt?: string | null;
  obStep?: number;
  candidateName?: string | null;
  candidateContact?: string | null;
  candidatePortfolio?: string | null;
  candidateResponses?: string | null; // JSON ответов кандидата по блокам онбординга
}

export interface LeadLifecycle {
  contact?: string | null;
  conditionsSentAt?: string | null;
  testSentAt?: string | null;
  testDeadlineAt?: string | null;
  testSubmittedUrl?: string | null;
  testSubmittedAt?: string | null;
  decisionReason?: string | null;
  role?: string | null;
  rate?: string | null;
  startedAt?: string | null;
  nextTouchAt?: string | null;
  obStep?: number;
  candidateName?: string | null;
  candidateContact?: string | null;
}

export interface LeadComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface LeadDetail extends Lead {
  comments: LeadComment[];
}

export interface Overview {
  kpi: {
    leadsTotal: number;
    leadsToday: number;
    leads7: number;
    replyRate: number;
    postsTotal: number;
    posts7: number;
    searchesActive: number;
    searchesTotal: number;
    connections: number;
    devicesOnline: number;
    rolesAtRisk: number;
  };
  series: { label: string; total: number; replied: number }[];
  sections: { requests: number; hidden: number; main: number; unknown: number };
  topSearches: { id: string; title: string; count: number }[];
  teamHealth: { id: string; title: string; hired: number; bench: number; reserveTarget: number }[];
}

export interface ActivityEvent {
  type: 'post' | 'lead';
  at: string;
  search: string;
  ok?: boolean;
  who?: string | null;
  keyword?: string;
}

export interface TodoItem {
  type: 'test_overdue' | 'review' | 'test_soon' | 'bench_touch';
  priority: number;
  leadId: string;
  name: string;
  searchId: string;
  searchTitle: string;
  detail: string;
  at: string | null;
}

export interface OnboardingSummaryRow {
  id: string;
  title: string;
  issued: number;
  finished: number;
}

export interface OnboardingFunnel {
  issued: number;
  steps: { title: string; reached: number }[];
  finished: number;
}

export interface PublishedPostRow {
  id: string;
  searchTitle: string;
  text: string;
  mediaType: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  threadsPostId: string | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export interface PublishCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface TestPublishResult {
  ready: boolean;
  dryRun: true;
  connection: string | null;
  checks: PublishCheck[];
  wouldPost: { index: number; text: string; mediaUrl: string | null; mediaType: string | null; rotation: string; segmentCount?: number; mediaCount?: number } | null;
}

export interface GoalConfig {
  goalEnabled: boolean;
  goalHires: number;
  goalConversion: number;
  goalDueAt: string | null;
  goalStartedAt: string | null;
}

export interface GoalState {
  config: GoalConfig;
  requiredLeads: number;
  leads: number;
  hires: number;
  leadsLast3d: number;
  lastLeadAt: string | null;
  lastLeadAgeDays: number | null;
  daysLeft: number | null;
  expectedLeads: number | null;
  onPace: boolean | null;
  stale: boolean;
}

export interface GoalSummaryRow extends Omit<GoalState, 'config'> {
  id: string;
  title: string;
  goalHires: number;
  goalDueAt: string | null;
}

export type CampaignStatus = 'draft' | 'pending_review' | 'active' | 'paused';

export interface AdCampaign {
  id: string;
  searchId: string;
  search?: { title: string };
  name: string;
  bundleKey: string;
  status: CampaignStatus;
  objective: string;
  dailyBudget: number;
  currency: string;
  geo: string;
  ageMin: number;
  ageMax: number;
  interests: string;
  creativeHeadline: string;
  creativeText: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  codeWord: string;
  ctaLabel: string;
  createdAt: string;
  updatedAt: string;
  // атрибуция (приходит из списка кампаний)
  leads?: number;
  hires?: number;
}

export interface MetaConnection {
  connected: boolean;
  adAccountId?: string;
  businessName?: string;
  status?: 'pending' | 'active';
}

export interface SearchStats {
  kpi: { leadsTotal: number; leadsToday: number; leads7: number; replyRate: number; postsTotal: number };
  series: { label: string; total: number; replied: number }[];
  sections: { requests: number; hidden: number; main: number; unknown: number };
}

export interface Device {
  id: string;
  label: string | null;
  version: string | null;
  threadsLoggedIn: boolean;
  online: boolean;
  lastHeartbeat: string | null;
}

export interface Connection {
  id: string;
  username: string;
  threadsUserId: string;
  searches: number;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  plan: 'FREE' | 'PRO' | 'VIP';
  role: 'USER' | 'ADMIN';
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  plan: 'FREE' | 'PRO' | 'VIP';
  role: 'USER' | 'ADMIN';
  extraSeats?: number;
  createdAt: string;
  _count: { searches: number; leads: number; connections: number; devices: number };
  subscription?: { status: string; currentPeriodEnd: string | null } | null;
}

export interface Workspace {
  role: 'OWNER' | 'MANAGER' | 'VIEWER';
  isMember: boolean;
  ownerEmail: string;
  company: string;
  plan: 'FREE' | 'PRO' | 'VIP';
}

export interface TeamMember {
  id: string;
  email: string;
  role: 'MANAGER' | 'VIEWER';
  linked: boolean;
  createdAt: string;
}

export interface TeamInfo {
  members: TeamMember[];
  seats: number;
  used: number;
}

export interface AdminStats {
  users: number;
  new7: number;
  searches: number;
  leads: number;
  posts: number;
  byPlan: { FREE: number; PRO: number; VIP: number };
  aiToday: number;
  subs: Record<string, number>;
  mrr: number;
  payingUsers: number;
}

export interface AccountQuota {
  plan: 'FREE' | 'PRO' | 'VIP';
  extraSeats: number;
  used: number;
  limit: number;
}

export interface AdminCosts {
  ai: { today: number; month: number; all: number; estMonthUsd: number; costPerGenUsd: number };
  series: { day: string; count: number }[];
}

export interface AdminGrowth {
  signupsByWeek: { week: string; count: number }[];
  activation: { total: number; connected: number; withSearch: number; withLead: number; paying: number };
  engagement: { dau: number; wau: number; mau: number; stickiness: number };
  revenue: { mrr: number; arr: number; arpu: number; payingPct: number; churnedSubs: number };
  adoption: { autopost: number; otbivka: number; onboarding: number; campaigns: number };
  powerUsers: { email: string; leads: number; hired: number }[];
}

export interface AdminAnalytics {
  totalLeads: number;
  totalHired: number;
  convToHire: number; // % лид → наём
  totalPosts: number;
  leadsPerPost: number;
  funnel: Record<string, number>; // NEW|CONTACTED|SCREENING|HIRED|BENCH|REJECTED
  bySection: Record<string, number>; // requests|hidden|main
  byProfession: { title: string; leads: number; hired: number; conv: number }[];
}

export interface Limits {
  replyDelaySec: number;
  maxRepliesPerDay: number;
  maxDialogsPerSweep: number;
  workingHoursEnabled: boolean;
  activeFrom: string;
  activeTo: string;
  sweepIntervalMinutes: number;
  safeMode: boolean;
  sweepMain: boolean;
  sweepRequests: boolean;
  sweepHidden: boolean;
  researchEnabled: boolean;
  runNowAt?: string | null;
  caps?: { replyDelayMin: number; repliesMax: number; dialogsMax: number; intervalMin: number };
}

export interface BrandProfile {
  companyName: string;
  niche: string;
  social: string;
  about: string;
  tone: string;
  audience: string;
  perks: string;
  signature: string;
  sample: string;
  avoid: string;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  utm: string | null; // JSON UTM-меток рекламы
  status: 'new' | 'invited' | 'converted';
  createdAt: string;
}

export interface PromoCodeRow {
  id: string;
  code: string;
  percentOff: number;
  durationMonths: number;
  maxRedemptions: number;
  redeemedCount: number;
  issuedToEmail: string | null;
  campaign: string;
  used: boolean;
  expiresAt: string | null;
  createdAt: string;
}
