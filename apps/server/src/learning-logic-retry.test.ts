import { expect, it } from 'vitest';
import { makeReasoningTask, checkReasoningAnswer } from './reasoning-assessment';
it('checks deterministic logic retries', () => { const task=makeReasoningTask('logic',2); expect(checkReasoningAnswer(task,task.expected)).toBe(true); });
