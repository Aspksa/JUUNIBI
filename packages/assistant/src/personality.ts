/** Versioned, reviewable behavioral adaptation. No model-weight training or autonomous writes. */
export type Trait = "warmth" | "curiosity" | "brevity" | "initiative";
export type TraitScores = Record<Trait, number>;
export interface PersonalitySnapshot {
  version: number;
  traits: TraitScores;
  acceptedLessons: string[];
  lessonTexts?: Record<string, string>;
}
export interface LessonProposal {
  id: string;
  lesson: string;
  evidence: string[];
  confidence: number;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function initialPersonality(): PersonalitySnapshot {
  return { version: 1, traits: { warmth: 0.7, curiosity: 0.6, brevity: 0.5, initiative: 0.4 }, acceptedLessons: [], lessonTexts: {} };
}
export function proposeLesson(id: string, lesson: string, evidence: string[], confidence: number): LessonProposal {
  if (!id.trim() || !lesson.trim() || evidence.length === 0 || !Number.isFinite(confidence)) throw new Error("Invalid lesson proposal");
  return { id, lesson: lesson.trim().slice(0, 500), evidence: evidence.slice(0, 10).map(x => x.slice(0, 300)), confidence: clamp(confidence) };
}
export function acceptLesson(snapshot: PersonalitySnapshot, proposal: LessonProposal, approved: boolean): PersonalitySnapshot {
  if (!approved || proposal.confidence < 0.6 || snapshot.acceptedLessons.includes(proposal.id)) return snapshot;
  return { ...snapshot, version: snapshot.version + 1, acceptedLessons: [...snapshot.acceptedLessons, proposal.id], lessonTexts: { ...snapshot.lessonTexts, [proposal.id]: proposal.lesson.trim().slice(0, 500) } };
}
export function evolveTrait(snapshot: PersonalitySnapshot, trait: Trait, delta: number, approved: boolean): PersonalitySnapshot {
  if (!approved || !Number.isFinite(delta)) return snapshot;
  const value = clamp(snapshot.traits[trait] + Math.max(-0.1, Math.min(0.1, delta)));
  if (value === snapshot.traits[trait]) return snapshot;
  return { ...snapshot, version: snapshot.version + 1, traits: { ...snapshot.traits, [trait]: value } };
}
export function rollbackPersonality(history: readonly PersonalitySnapshot[], version: number): PersonalitySnapshot {
  const found = history.find(x => x.version === version);
  if (!found) throw new Error("Unknown personality version");
  return structuredClone(found);
}
