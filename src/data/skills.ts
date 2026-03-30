import { Skill, createSkill } from '../types/mission'

export const DEFAULT_SKILLS: Skill[] = [
  createSkill({
    id: 'skill-reddit-posting',
    name: 'Reddit Post Creation',
    description: 'Guidelines for writing engaging Reddit posts that drive sales interest without being spammy.',
    builtIn: true,
    priority: 90,
    activationTriggers: [
      { type: 'url_pattern', value: 'reddit.com' },
      { type: 'mission_type', value: 'reddit' },
    ],
    content: `# Reddit Post Creation Skill

## Core Principles
- Write value-first content. Your post should help the community BEFORE promoting anything.
- Match the subreddit's tone and culture. Read the top 5 posts before writing.
- Never use hard-sell language. Think "helpful expert sharing insights" not "salesperson."

## Post Structure
1. **Hook**: Open with a relatable problem or surprising insight (1-2 sentences)
2. **Value**: Share actionable advice, data, or a story (3-5 paragraphs)
3. **Soft CTA**: End with an invitation to discuss, not a sales pitch

## Formatting Tips
- Use markdown headers (##) for sections in longer posts
- Bold key takeaways for skimmers
- Keep paragraphs short (2-3 sentences max)
- Use bullet points for lists

## Subreddit Etiquette
- Read and follow each subreddit's rules before posting
- Engage with comments on your post for at least 2 hours after posting
- Don't cross-post the same content to multiple subreddits simultaneously
- Flair your posts appropriately

## What NOT to Do
- Don't include links in the first post (build trust first)
- Don't use clickbait titles
- Don't post more than once per subreddit per week
- Don't ignore negative comments — address them professionally

## Title Formula
[Number/How-to] + [Specific Benefit] + [For Whom]
Example: "5 Cold Email Templates That Got Us 40% Response Rates in B2B SaaS"`,
  }),

  createSkill({
    id: 'skill-reddit-reply',
    name: 'Reddit Reply & Comment',
    description: 'How to write helpful, non-spammy replies that build authority and drive interest.',
    builtIn: true,
    priority: 85,
    activationTriggers: [
      { type: 'url_pattern', value: 'reddit.com' },
      { type: 'mission_type', value: 'reddit' },
    ],
    content: `# Reddit Reply & Comment Skill

## Reply Strategy
- Only reply to posts/comments where you can add genuine value
- Lead with empathy — acknowledge the person's situation before advising
- Share personal experience or data when possible

## Reply Structure
1. **Acknowledge**: "Great question" or "I've dealt with this exact issue"
2. **Answer**: Provide a clear, specific answer
3. **Expand**: Add context, examples, or nuance
4. **Invite**: "Happy to elaborate if you want more detail"

## Tone Guidelines
- Conversational but knowledgeable
- Avoid jargon unless the subreddit expects it
- Use "I" and "we" naturally — be a person, not a brand
- Match the energy of the thread (serious problem = serious tone)

## Building Authority
- Reply to multiple threads in the same subreddit consistently
- Upvote good content from others
- Reference your own experiences without linking to your product
- Answer follow-up questions promptly

## Red Flags to Avoid
- Don't reply with just a link
- Don't copy-paste the same reply across threads
- Don't argue with trolls
- Don't promote in threads about negative experiences`,
  }),

  createSkill({
    id: 'skill-linkedin-outreach',
    name: 'LinkedIn Outreach',
    description: 'Connection request messages, profile engagement patterns, and follow-up strategies.',
    builtIn: true,
    priority: 80,
    activationTriggers: [
      { type: 'url_pattern', value: 'linkedin.com' },
      { type: 'mission_type', value: 'linkedin' },
    ],
    content: `# LinkedIn Outreach Skill

## Connection Request Strategy
- Always include a personalized note (max 300 chars)
- Reference something specific from their profile, post, or company
- State a clear reason for connecting (shared interest, mutual connection, relevant content)

## Message Templates

### Cold Connection
"Hi [Name], I noticed your work on [specific project/post]. I'm working on similar challenges in [area] and would love to connect and exchange ideas."

### Warm Introduction
"Hi [Name], [Mutual Connection] suggested I reach out. I'm impressed by [specific achievement] and think there's synergy between our work in [area]."

### Content Engagement First
Before connecting, engage with 2-3 of their posts (thoughtful comments, not just likes). Then: "Hi [Name], I've been following your posts about [topic] — your take on [specific point] really resonated. Would love to connect."

## Follow-Up Sequence
1. Day 0: Connection request with personalized note
2. Day 1-2 (after accepted): Thank them, share a relevant resource
3. Day 5-7: Ask a thoughtful question about their work
4. Day 14+: If conversation is going well, suggest a brief call

## Profile Engagement Patterns
- Comment on posts before sending connection requests
- Share their content with your own added insight
- Endorse skills relevant to your shared domain

## What NOT to Do
- Don't pitch in the connection request
- Don't send generic "I'd like to add you to my network" messages
- Don't follow up more than twice if they don't respond
- Don't send voice messages to strangers`,
  }),

  createSkill({
    id: 'skill-google-research',
    name: 'Google Research',
    description: 'How to search effectively, extract key information, and compile research notes.',
    builtIn: true,
    priority: 70,
    activationTriggers: [
      { type: 'url_pattern', value: 'google.com' },
      { type: 'mission_type', value: 'research' },
    ],
    content: `# Google Research Skill

## Search Strategies
- Use specific, targeted queries instead of broad terms
- Use quotes for exact phrases: "sales automation tools"
- Use site: operator to search specific domains: site:reddit.com "cold email"
- Use minus to exclude: automation tools -free -trial
- Use filetype: for documents: filetype:pdf "sales playbook"

## Research Workflow
1. **Define objective**: What specific information do you need?
2. **Initial broad search**: Get an overview of the topic
3. **Refine queries**: Use specific terms from initial results
4. **Deep dive**: Visit top 3-5 results and extract key data
5. **Cross-reference**: Verify claims across multiple sources
6. **Compile**: Organize findings into structured notes

## Information Extraction
- Look for: pricing, features, team size, founding date, recent news
- Check "About" pages for company overview
- Check LinkedIn for team size and key personnel
- Check Crunchbase or similar for funding information
- Check review sites (G2, Capterra) for user sentiment

## Note Format
For each research target, capture:
- Company/Person name
- Key facts (size, revenue, market)
- Relevant quotes or data points
- Source URLs
- Date of information`,
  }),

  createSkill({
    id: 'skill-openhumana-brand-voice',
    name: 'OpenHumana Brand Voice',
    description: 'Deep brand context for OpenHumana: voice, positioning, indirect promotion strategy, and what never to say.',
    builtIn: true,
    priority: 95,
    activationTriggers: [
      { type: 'url_pattern', value: 'reddit.com' },
      { type: 'mission_type', value: 'reddit' },
      { type: 'mission_type', value: 'post content campaign' },
      { type: 'mission_type', value: 'engagement patrol' },
      { type: 'mission_type', value: 'subreddit monitor' },
    ],
    content: `# OpenHumana Brand Voice

## What OpenHumana Does
OpenHumana: AI voice agents for outbound sales — automates cold calling, lead qualification, and appointment setting. Target verticals: wholesale real estate, insurance, solar/home services, outbound B2B sales.

## Indirect Promotion Strategy (never lead with the product)
1. Establish credibility — share data-backed insights about outbound sales pain points
2. Surface pain points — name specific frustrations (low connect rates, rep burnout, manual dialing)
3. Let people ask — end posts with open questions; only mention OpenHumana if someone asks directly

## Voice Rules
- Write as a peer practitioner, NOT a vendor
- Ground claims in numbers and real outcomes; no superlatives
- Plain-spoken and direct; empathetic about how hard outbound is

## NEVER Say
- Never name "OpenHumana" unless explicitly instructed
- Never use: AI dialer, AI voice agent, or product-category pitch language
- Never use: revolutionize, disrupt, game-changer, cutting-edge
- Never include links to openhumana.com in posts
- Never repost identical content across multiple subreddits

## Post Opener Examples
- "We ran 10,000 cold calls last quarter — here's what the data showed about connect rates..."
- "Unpopular opinion: most outbound teams have a follow-up problem, not a prospecting problem..."
- "I've worked with insurance agents doing 200 dials a day. The single biggest mistake I see is..."
- "Wholesale real estate cold calling is brutal right now. Here's the pattern I'm seeing..."

## Success Criteria
Post reads like authentic community member content. No brand mentions. Someone asks "what system are you using?" — that's the goal.`,
  }),

  createSkill({
    id: 'skill-subreddit-intelligence',
    name: 'Subreddit Intelligence',
    description: 'Curated database of 20+ subreddits organized by industry with audience profiles, posting frequency, content guidance, and self-promotion rules.',
    builtIn: true,
    priority: 92,
    activationTriggers: [
      { type: 'url_pattern', value: 'reddit.com' },
      { type: 'mission_type', value: 'reddit' },
      { type: 'mission_type', value: 'post content campaign' },
      { type: 'mission_type', value: 'engagement patrol' },
      { type: 'mission_type', value: 'subreddit monitor' },
    ],
    content: `# Subreddit Intelligence

## Subreddit Map (Industry → Best Subreddits)
**Outbound sales / cold calling**: r/sales (2x/wk, no promo), r/coldcalling (3x/wk, moderate promo ok), r/B2BSales (2x/wk, low promo), r/coldemail (3x/wk, no tool promo), r/leadgeneration (2x/wk, disclose), r/salesops (1x/wk, no promo)
**Wholesale real estate**: r/WholesaleRealEstate (3x/wk, moderate promo ok), r/realestateinvesting (2x/wk, low promo), r/realestate (1x/wk, no promo), r/REIclub (2x/wk, low promo)
**Insurance**: r/InsuranceAgent (2x/wk, limited promo), r/InsuranceProfessional (1x/wk, no promo)
**Solar / home services**: r/solar (1x/wk, no promo), r/solarenergy (1x/wk, no promo), r/HomeImprovement (1x/2wk, no promo), r/SolarDIY (1x/2wk, no promo), r/SolarInstallation (1x/wk, moderate promo ok)
**General business**: r/entrepreneur (2x/wk, low promo), r/smallbusiness (2x/wk, disclose), r/startups (2x/wk, low promo), r/marketing (2x/wk, no promo), r/digital_marketing (2x/wk, low promo), r/salesforce (1x/wk, no promo)

## Topic → Subreddit Routing
- Cold calling / dialing / connect rates → r/coldcalling, r/sales
- SDR / outbound / prospecting → r/sales, r/B2BSales
- Skip tracing / motivated sellers / wholesale → r/WholesaleRealEstate
- Insurance leads / agent prospecting → r/InsuranceAgent
- Solar appointment setting → r/solar, r/SolarInstallation
- General outbound / AI calling → r/sales, r/entrepreneur

## What Performs Well (Universal Rules)
- Data-backed insights with real numbers
- "What actually worked / what failed" stories
- Tactical how-to posts (not theory)
- Honest takes on industry pain points

## Thread Engagement Criteria
Only reply if ALL three: (1) real specific problem, (2) fewer than 20 replies, (3) posted within 48 hours.

## Engagement Keywords to Search
cold calling, outbound, SDR, BDR, prospecting, connect rate, appointment setting, skip tracing, insurance leads, lead gen, power dialer, rep burnout`,
  }),

  createSkill({
    id: 'skill-custom-template',
    name: 'Custom Skill Template',
    description: 'A blank template with instructions for creating your own skills.',
    builtIn: true,
    priority: 10,
    activationTriggers: [
      { type: 'manual', value: 'custom' },
    ],
    enabled: false,
    content: `# [Your Skill Name]

## Purpose
Describe what this skill teaches the agent to do.

## When to Activate
- URL patterns: (e.g., "example.com")
- Mission types: (e.g., "outreach", "research")

## Core Guidelines
1. [First principle or rule]
2. [Second principle or rule]
3. [Third principle or rule]

## Step-by-Step Process
1. [First step]
2. [Second step]
3. [Third step]

## Templates / Examples
[Add any message templates, format examples, or sample outputs]

## What to Avoid
- [Anti-pattern 1]
- [Anti-pattern 2]

## Success Criteria
How to know if the agent followed this skill correctly:
- [Criterion 1]
- [Criterion 2]`,
  }),
]
