/** Infrastructure failure after provider acceptance, not a provider failure. */
export class PollDispatchError extends Error {
  constructor(cause: unknown) {
    super('Accepted generation could not schedule its next status check', {
      cause,
    });
    this.name = 'PollDispatchError';
  }
}
