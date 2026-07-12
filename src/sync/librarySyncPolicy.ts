// Ported unchanged from desktop v1.1.11 (librarySyncPolicy.ts): guards the
// whole-library snapshot against the "fresh device wipes the folder tree"
// failure mode on both push timing and pull application.
export interface LibraryStructure {
  collections: readonly unknown[]
  paper_collections: readonly unknown[]
  tags?: readonly unknown[]
  paper_tags?: readonly unknown[]
}

export interface RemoteLibraryDecision {
  remoteUpdatedAt: number
  localUpdatedAt: number
  remoteHasStructure: boolean
  localHasStructure: boolean
  localDirty: boolean
  revisionIsCurrent: boolean
}

export function libraryHasStructure(library: LibraryStructure): boolean {
  return (
    library.collections.length > 0 ||
    library.paper_collections.length > 0 ||
    (library.tags?.length ?? 0) > 0 ||
    (library.paper_tags?.length ?? 0) > 0
  )
}

/**
 * A timestamp normally decides which library snapshot wins. A freshly created
 * device can, however, inherit a newer empty timestamp while papers are being
 * restored. In that one safe case, accept a non-empty remote structure so the
 * device does not permanently lose collections and tags.
 */
export function shouldApplyRemoteLibrary(decision: RemoteLibraryDecision): boolean {
  if (!decision.revisionIsCurrent || decision.localDirty) return false
  // A completely empty remote snapshot can be produced by a newly connected
  // device. Never let it erase an existing local collection tree implicitly.
  // Individual deletions still sync normally while either side retains any
  // collection, link, or tag. Clearing the final item requires an explicit
  // local action on each remaining device, which is the safer failure mode.
  if (decision.localHasStructure && !decision.remoteHasStructure) return false
  if (decision.remoteUpdatedAt > decision.localUpdatedAt) return true
  return !decision.localHasStructure && decision.remoteHasStructure
}
