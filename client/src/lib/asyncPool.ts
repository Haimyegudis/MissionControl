/**
 * Map work with a small, fixed number of workers.
 *
 * Bulk operations should be faster than a serial loop without producing an
 * unbounded burst of requests against Jira or TestRail.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        try {
          results[index] = { status: 'fulfilled', value: await worker(values[index], index) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }),
  );

  return results;
}

