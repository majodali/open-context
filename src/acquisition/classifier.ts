/**
 * Classifier interface and rule-based implementation.
 * Classifies content into types and tags.
 */

import type { ContentClassification, ContentType } from '../core/types.js';

export interface Classifier {
  classify(content: string): Promise<ContentClassification>;
}

interface ClassificationRule {
  pattern: RegExp;
  contentType: ContentType;
  tags: string[];
  priority: number;
}

const DEFAULT_RULES: ClassificationRule[] = [
  {
    pattern: /^(always|never|must|should|shall|do not|don't|ensure|require)\b/i,
    contentType: 'rule',
    tags: ['constraint'],
    priority: 10,
  },
  {
    pattern: /^(when|if|unless|before|after)\b.*\b(then|do|must|should)\b/i,
    contentType: 'rule',
    tags: ['conditional'],
    priority: 9,
  },
  {
    pattern: /^(step \d|first|second|third|next|finally|to do this)\b/i,
    contentType: 'instruction',
    tags: ['procedural'],
    priority: 8,
  },
  {
    pattern: /^(use|run|execute|call|invoke|import|install)\b/i,
    contentType: 'instruction',
    tags: ['action'],
    priority: 7,
  },
  {
    pattern: /^(decided|decision|agreed|we will|chosen|selected)\b/i,
    contentType: 'decision',
    tags: ['decision'],
    priority: 8,
  },
  {
    pattern: /^(noticed|observed|found|discovered|saw|appears|seems)\b/i,
    contentType: 'observation',
    tags: ['observation'],
    priority: 6,
  },
  {
    pattern: /\b(is|are|was|were|has|have|contains|equals|defined as)\b/i,
    contentType: 'fact',
    tags: ['definition'],
    priority: 3,
  },
];

/**
 * Rule-based classifier using regex patterns.
 * Fast and local — no LLM needed. Can be replaced with an LLM-based classifier later.
 */
export class RuleBasedClassifier implements Classifier {
  private rules: ClassificationRule[];

  constructor(customRules?: ClassificationRule[]) {
    this.rules = customRules ?? DEFAULT_RULES;
  }

  async classify(content: string): Promise<ContentClassification> {
    let bestMatch: { contentType: ContentType; tags: string[]; priority: number } | null = null;

    for (const rule of this.rules) {
      if (rule.pattern.test(content)) {
        if (!bestMatch || rule.priority > bestMatch.priority) {
          bestMatch = {
            contentType: rule.contentType,
            tags: [...rule.tags],
            priority: rule.priority,
          };
        }
      }
    }

    if (bestMatch) {
      return {
        contentType: bestMatch.contentType,
        tags: bestMatch.tags,
        confidence: Math.min(1.0, bestMatch.priority / 10),
      };
    }

    // Default: classify as statement
    return {
      contentType: 'statement',
      tags: [],
      confidence: 0.5,
    };
  }
}
