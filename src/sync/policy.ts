/**
 * Tracks mutations that happen while an asynchronous sync operation is in
 * flight. Timestamps alone are insufficient because two edits can occur in
 * the same millisecond. (Ported from the desktop app's syncPolicy.ts.)
 */
export class MutationRevisionTracker {
  private sequence = 0
  private revisions = new Map<string, number>()

  mark(key: string): number {
    const revision = ++this.sequence
    this.revisions.set(key, revision)
    return revision
  }

  snapshot(key: string): number {
    return this.revisions.get(key) ?? 0
  }

  isCurrent(key: string, snapshot: number): boolean {
    return this.snapshot(key) === snapshot
  }

  forgetIfCurrent(key: string, snapshot: number): boolean {
    if (!this.isCurrent(key, snapshot)) return false
    this.revisions.delete(key)
    return true
  }
}
