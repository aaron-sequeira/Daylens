import type { LayaQuestion } from './laya';

/** Confidence threshold consumers use: finalCategory keeps a guess below it only when the app isn't a known one; Phase 5 rules act only on labels at or above it. */
export const CONFIDENT = 0.5;

// Single source of truth for what the Brain asks. Only `category` wording is tuned (Task 2 of Phase 4).
export const QUESTIONS: Record<'category' | 'activity' | 'stuck' | 'distraction', LayaQuestion> = {
  category: {
    type: 'choice',
    instructions: 'What is this screen mainly for? Judge by the content on screen, not only the app name.',
    criteria: {
      work: 'doing a job or study task: writing code, documents, spreadsheets, slides, design files, code review, admin forms',
      learning: 'deliberately studying: tutorials, courses, lectures, documentation or reference pages, flashcards, practice exercises',
      social: 'personal social life: social media feeds, posts and comments, chatting with friends or family, community servers and forums',
      entertainment: 'watching, listening or playing for fun: videos for fun, streams, movies and shows, music players, games, memes',
      communication: 'work or school communication: email inboxes, work chat channels, calendars, meeting and call windows',
      other: 'anything else: system settings, file management, installers, online shopping, maps, banking-free admin'
    }
  },
  activity: {
    type: 'choice',
    instructions: 'What is the user doing right now?',
    criteria: ['coding', 'writing', 'reading', 'watching', 'scrolling', 'chatting', 'designing', 'gaming', 'browsing', 'other']
  },
  stuck: {
    type: 'score',
    instructions: 'How stuck or blocked does the user appear on their current task?',
    criteria: ['working smoothly', 'minor friction, searching for answers', 'visible errors, failures or repeated attempts']
  },
  distraction: {
    type: 'score',
    instructions: 'How distracting is this screen compared with focused work?',
    criteria: ['on-task', 'mild detour', 'infinite feed, autoplay, clickbait or unrelated to work']
  }
};
