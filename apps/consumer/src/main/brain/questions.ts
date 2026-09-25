import type { LayaQuestion } from './laya';

/** Choices below this confidence are stored as 'uncertain' and never drive the UI or rules. */
export const CONFIDENT = 0.5;

// Single source of truth for what the Brain asks. Only `category` wording is tuned (Task 2 of Phase 4).
export const QUESTIONS: Record<'category' | 'activity' | 'stuck' | 'distraction', LayaQuestion> = {
  category: {
    type: 'choice',
    instructions: 'Which kind of activity is the user doing on this screen?',
    criteria: {
      work: 'job or study tasks: coding, documents, spreadsheets, design, admin',
      learning: 'tutorials, documentation, courses, educational videos',
      social: 'social media feeds, personal messaging, forums',
      entertainment: 'videos, streaming, games, memes, music for fun',
      communication: 'email, work chat, calendars, meetings',
      other: 'system settings, file management, shopping, anything else'
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
