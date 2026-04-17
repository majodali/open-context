import { describe, it, expect } from 'vitest';
import { RuleBasedClassifier } from '../src/acquisition/classifier.js';

describe('RuleBasedClassifier', () => {
  const classifier = new RuleBasedClassifier();

  it('classifies rules', async () => {
    const result = await classifier.classify('Always validate user input before processing.');
    expect(result.contentType).toBe('rule');
  });

  it('classifies instructions', async () => {
    const result = await classifier.classify('Use the OpenAI API to generate embeddings.');
    expect(result.contentType).toBe('instruction');
  });

  it('classifies decisions', async () => {
    const result = await classifier.classify('Decided to use TypeScript for the project.');
    expect(result.contentType).toBe('decision');
  });

  it('classifies observations', async () => {
    const result = await classifier.classify('Noticed that the API response time increased.');
    expect(result.contentType).toBe('observation');
  });

  it('defaults to statement', async () => {
    const result = await classifier.classify('The sky looks nice today.');
    expect(result.contentType).toBe('statement');
  });
});
