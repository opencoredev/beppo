export const ARCHIVE_RETENTION_DAYS = 30;
export const ARCHIVED_THREAD_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function archiveDeleteAtIso(archivedAt: string): string {
  return new Date(Date.parse(archivedAt) + ARCHIVED_THREAD_RETENTION_MS).toISOString();
}
