/**
 * The engine client wraps every fetch rejection (including its own connection cutoffs) in a
 * ClientError with reason `Transport`, so a dropped connection is distinguishable from an
 * engine answer.
 */
export function isTransportDrop(error: unknown): boolean {
  return error instanceof Error && error.name === 'ClientError' && (error as { reason?: string }).reason === 'Transport';
}
