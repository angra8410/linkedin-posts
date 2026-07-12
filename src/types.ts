export type RewriteStyle =
  | "concise"
  | "story"
  | "bold"
  | "data-driven"
  | "question-led"
  | "linkedin-polish"
  | "shorter"
  | "more-human"
  | "candid";

export type PostDraftStatus = "draft" | "ready" | "posted" | "ready-manual" | "error";
export type AppTheme = "light" | "dark";
export type GenerationInputMode = "topic" | "source";

export interface UserBrandProfile {
  id: string;
  name: string;
  currentTitle: string;
  targetTitle: string;
  yearsExperience: number;
  skills: string[];
  industries: string[];
  tone: "professional" | "conversational" | "authoritative" | "story-driven";
  contentPillars: string[];
  audience: string;
  createdAt: number;
  updatedAt: number;
  linkedinUrl?: string;
  githubUrl?: string;
}

export interface TargetRole {
  id: string;
  title: string;
  keywords: string[];
  companies: string[];
  notes: string;
}

export interface ContentPillar {
  id: string;
  name: string;
  description: string;
  exampleTopics: string[];
  frequency: "daily" | "weekly" | "biweekly";
}

export interface SavedPrompt {
  id: string;
  label: string;
  systemMessage: string;
  userTemplate: string;
  category: "draft" | "rewrite" | "hook" | "cta" | "scoring" | "strategy";
  createdAt: number;
}

export interface CarouselSlideBullet {
  label: string;
  text: string;
}

export interface CarouselSlide {
  slideNumber: number;
  isTitleSlide?: boolean;
  category?: string;
  title: string;
  subtitle?: string;
  content?: string;
  image?: string;
  bullets?: CarouselSlideBullet[];
}

export interface PostDraft {
  id: string;
  prompt: string;
  content: string;
  pillar: string;
  model: string;
  scoringResult?: ScoringResult;
  variants: string[];
  hashtags?: string[];
  status: PostDraftStatus;
  scheduledAt?: number;
  postedAt?: number;
  linkedinPostId?: string;
  errorMessage?: string;
  carouselSlides?: CarouselSlide[];
  videoUrn?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RewriteVariant {
  id: string;
  draftId: string;
  style: RewriteStyle;
  content: string;
  model: string;
  createdAt: number;
}

export interface ScoringResult {
  id: string;
  draftId: string;
  scores: {
    hook: number;
    clarity: number;
    relevance: number;
    cta: number;
    authenticity: number;
  };
  totalScore: number;
  feedback: string[];
  model: string;
  createdAt: number;
}

export interface PerformanceLog {
  id: string;
  sourceDraftId?: string;
  linkedinPostId?: string;
  postTitle: string;
  postedAt: number;
  pillar: string;
  hashtags?: string[];
  format: "list" | "story" | "insight" | "question" | "data";
  mediaFormat?: "carousel" | "video" | "text";
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  profileViews: number;
  notes: string;
  createdAt: number;
  updatedAt?: number;
}

export interface PerformanceLogSeedPayload {
  sourceDraftId: string;
  postTitle: string;
  pillar: string;
  postedAt: number;
  format?: PerformanceLog["format"];
  contentSnippet?: string;
}

export interface AIRecommendation {
  id: string;
  type: "pillar" | "format" | "timing" | "topic" | "hook";
  content: string;
  basedOn: string;
  createdAt: number;
}

export interface WeeklyStrategySummary {
  id: string;
  weekStart: number;
  plannedPosts: Array<{
    dayOfWeek: number;
    pillar: string;
    topicIdea: string;
    format: string;
  }>;
  aiNarrative: string;
  createdAt: number;
}

export interface ScoreComparisonPayload {
  main: string;
  variant1?: string;
  variant2?: string;
  variant3?: string;
  sourceTopic?: string;
  createdAt: number;
}

export interface DraftPromotionPayload {
  content: string;
  sourceLabel?: string;
  sourceTopic?: string;
  sourcePillar?: string;
  scoringResult?: ScoringResult;
  autoGenerate?: boolean;
  createdAt: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface OllamaStreamChunk {
  model: string;
  response: string;
  done: boolean;
}

export type OllamaStatus = "checking" | "online" | "offline" | "error";

export interface AppSettings {
  ollamaUrl: string;
  defaultModel: string;
  streamingEnabled: boolean;
  onboardingComplete: boolean;
  activeProfileId: string | null;
  theme: AppTheme;
  linkedinClientId?: string;
  linkedinClientSecret?: string;
  linkedinAccessToken?: string;
  linkedinMemberUrn?: string;
  linkedinTokenExpiresAt?: number;
}