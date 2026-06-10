import { UserBrandProfile } from '../types';

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

/**
 * 1. Post Generation Prompts
 */
export function promptGeneratePost(
  profile: UserBrandProfile,
  topic: string,
  pillar: string,
  mode: "topic" | "source"
) {
  const system = `You are a master LinkedIn content strategist. Write a highly-engaging post. 
- Avoid generic corporate jargon (e.g. "excited to announce", "delighted to share", "journey", "key learnings").
- Start with a strong hook (first line) that stops the feed scroll.
- Use clean formatting, bullet points, and blank lines for readability.
- Make it sound natural, candid, and direct.
- Do NOT use emojis under any circumstances. Keep the text entirely text-based.`;

  const user = mode === "source" 
    ? `Faithfully adapt the following source material into a LinkedIn post. Preserve the core arguments and facts but make it readable and engaging for LinkedIn.
Pillar: ${pillar}
Tone profile: ${profile.tone}
Writer context: ${profile.currentTitle} with ${profile.yearsExperience} years experience in ${profile.industries.join(', ')}.
Source Material:\n${topic}`
    : `Write a compelling LinkedIn post about the following topic.
Topic: ${topic}
Pillar: ${pillar}
Tone profile: ${profile.tone}
Target Audience: ${profile.audience}
Writer context: ${profile.currentTitle} with ${profile.yearsExperience} years experience.`;

  return { system, user };
}

/**
 * 2. Recruiter Showcase Posts
 */
export function promptRecruiterPost(
  profile: UserBrandProfile,
  topic: string,
  mode: "topic" | "source"
) {
  const system = `You are a professional brand manager helping a candidate stand out to recruiters on LinkedIn.
- Avoid braggy, arrogant, or hyper-polished corporate language.
- Speak in a humble, conversational, and direct tone.
- Showcase hands-on competency and specific technical impact.
- Do NOT use emojis under any circumstances. Keep the text entirely text-based.`;

  const user = mode === "source"
    ? `Adapt this source achievement into a LinkedIn post designed to catch the eye of hiring managers and recruiters. Highlight hard skills and clear impact.
Skills: ${profile.skills.join(', ')}
Target Role: ${profile.targetTitle}
Source Achievement:\n${topic}`
    : `Write a LinkedIn post showcasing the following achievement in a recruiter-friendly format. Focus on problem, solution, and impact.
Achievement: ${topic}
Skills: ${profile.skills.join(', ')}
Target Role: ${profile.targetTitle}`;

  return { system, user };
}

/**
 * 3. Personal Story Posts
 */
export function promptPersonalStoryPost(
  profile: UserBrandProfile,
  topic: string,
  mode: "topic" | "source"
) {
  const system = `You are a master storyteller helping a professional share authentic, human-first content on LinkedIn.
- NO tech jargon, no content pillars, no product names unless naturally part of the story.
- Lead with raw human emotion or a vivid scene — not a career achievement.
- Use short paragraphs. Build tension. Land on a universal truth or lesson.
- The post should feel like a conversation with a trusted friend, not a professional announcement.
- Do NOT use emojis under any circumstances. Keep the text entirely text-based.
- End with a single, open-ended question that invites the reader to reflect on their own experience.`;

  const user = mode === "source"
    ? `Adapt this source material into a deeply personal, human LinkedIn story. Strip out any corporate or technical framing. Focus on the emotional truth and universal lesson.
Writer: ${profile.name}, ${profile.currentTitle}
Source Material:\n${topic}`
    : `Write a personal story LinkedIn post about the following topic. Make it human, emotional, and universally relatable.
Topic: ${topic}
Writer: ${profile.name}, ${profile.currentTitle} with ${profile.yearsExperience} years of experience.
Tone: raw, honest, conversational — like ${profile.tone} but more personal.`;

  return { system, user };
}

/**
 * 4. Rewrite Style variation
 */
export function promptRewritePost(
  profile: UserBrandProfile,
  post: string,
  style: RewriteStyle
) {
  const system = `You are a master copywriter. Rewrite the provided LinkedIn post to be in a '${style}' style. 
- Do not add preambles or notes. Output ONLY the rewritten post.
- Do NOT use emojis under any circumstances, and strip any existing emojis from the source text. Keep the text entirely text-based.`;

  let styleGuidance = '';
  switch (style) {
    case 'concise':
      styleGuidance = 'Cut all unnecessary words, paragraphs, and fluff. Deliver the maximum impact with the absolute minimum character count.';
      break;
    case 'story':
      styleGuidance = 'Frame the post as a narrative. Start with a scene or a conflict, build the tension, explain what happened, and close with the lesson.';
      break;
    case 'bold':
      styleGuidance = 'Use punchy, strong declarations. Write in short sentences. Sound extremely confident and thought-provoking.';
      break;
    case 'data-driven':
      styleGuidance = 'Focus heavily on metrics, statistics, structures, and evidence. Organize the insights logically using numbers.';
      break;
    case 'question-led':
      styleGuidance = 'Engage the reader immediately by starting with a provocative question and structuring the content to answer it.';
      break;
    case 'shorter':
      styleGuidance = 'Reduce the length of the post by 50% while preserving all key insights and the core message.';
      break;
    case 'more-human':
      styleGuidance = 'Write as if you are talking over a casual coffee. Use contractions, casual words, and be highly relatable.';
      break;
    case 'candid':
      styleGuidance = 'Speak transparently about failures, mistakes, or hard truths. Avoid sanitizing or corporate sugarcoating.';
      break;
    default:
      styleGuidance = 'Polish the formatting, spacing, and rhythm of the text to be punchy and optimized for LinkedIn feeds.';
  }

  const user = `Rewrite this post.
Style instructions: ${styleGuidance}
Original Post:\n${post}`;

  return { system, user };
}

/**
 * 4. PDF Carousel / Slide Layout builder
 */
export function promptGenerateCarousel(post: string) {
  const system = `You are a professional slide presentation designer. Convert the provided LinkedIn post into a structured slide-by-slide strategy presentation deck.
- The deck must have 5-10 slides.
- Slide 1 must be a Title Slide with a bold title, a compelling subtitle, and a category. Set "isTitleSlide" to true.
- Subsequent slides must have a category (e.g. "FRAGMENTED DATA ECOSYSTEMS" or "COMPUTE DEPTH"), a punchy title, a brief 1-2 sentence description, and 1-2 key bullet points. Each bullet point should have a short label and a description.
- Keep text extremely brief. Do NOT use emojis.
- Return ONLY a valid JSON array of objects representing slides. Do not add markdown codeblocks, notes, or intros.
Format:
[
  {
    "slideNumber": 1,
    "isTitleSlide": true,
    "category": "STRATEGIC ARCHITECTURAL ASSESSMENT",
    "title": "Databricks vs. Microsoft Fabric",
    "subtitle": "Deciding Your Company's Entire Data Philosophy"
  },
  {
    "slideNumber": 2,
    "category": "FRAGMENTED DATA ECOSYSTEMS",
    "title": "The Silent Killer: Tool Sprawl",
    "content": "Modern data stacks are suffering from excessive tool fragmentation. When BI, SQL, and ETL are siloed, the cost is not just licensing, but operational velocity.",
    "bullets": [
      {
        "label": "Data Movement Latency",
        "text": "Development cycles stall due to friction in cross-tool pipelines."
      },
      {
        "label": "Governance Gaps",
        "text": "Fragmented tools create inconsistent security and metadata standards."
      }
    ]
  }
]`;

  const user = `Convert this post into a structured strategy presentation deck:
Post:\n${post}`;

  return { system, user };
}

/**
 * 5. Other Utility Prompt Builders
 */
export function promptGenerateHooks(profile: UserBrandProfile, topic: string) {
  const system = `You are a social copywriting hook expert. Generate 5 distinct, scroll-stopping hooks (opening lines) for a LinkedIn post about the user's topic.`;
  const user = `Topic: ${topic}\nWriter: ${profile.currentTitle}\nGenerate 5 different hooks (candid, question-based, shocking statistic, contrarian statement, story-opener).`;
  return { system, user };
}

export function promptGenerateCTAs(topic: string) {
  const system = `Generate 5 engaging Call-to-Action lines to end a LinkedIn post. Include question-based, resource-based, and discussion-focused options.`;
  const user = `Topic: ${topic}\nGenerate 5 CTA lines.`;
  return { system, user };
}

export function promptGenerateHashtags(
  profile: UserBrandProfile,
  content: string,
  topic: string,
  pillar: string
) {
  const system = `You are an SEO and hashtag optimization assistant. Generate 3 to 5 highly relevant professional hashtags for the post.`;
  const user = `Post:\n${content}\nPillar: ${pillar}\nTopic: ${topic}`;
  return { system, user };
}

export function promptScoreDraft(content: string) {
  const system = `You are an expert LinkedIn content validator. Score the post and return a JSON object containing scoring.`;
  const user = `Evaluate this post:\n${content}`;
  return { system, user };
}