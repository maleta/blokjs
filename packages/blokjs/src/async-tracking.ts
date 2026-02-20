export interface AsyncTrackingTarget {
  loadingData: Record<string, boolean>
  loadingProxy: any
  errorData: Record<string, any>
  errorProxy: any
}

export function wrapAsync(
  target: AsyncTrackingTarget,
  asyncCounts: Map<string, number>,
  key: string,
  result: any,
): void {
  if (!result || typeof result.then !== 'function') return

  if (!(key in target.loadingData)) {
    target.loadingData[key] = false
    target.errorData[key] = null
  }
  const count = (asyncCounts.get(key) ?? 0) + 1
  asyncCounts.set(key, count)
  target.loadingProxy[key] = true
  target.errorProxy[key] = null
  result.then(
    () => {
      const c = (asyncCounts.get(key) ?? 1) - 1
      asyncCounts.set(key, c)
      if (c <= 0) target.loadingProxy[key] = false
    },
    (err: any) => {
      const c = (asyncCounts.get(key) ?? 1) - 1
      asyncCounts.set(key, c)
      if (c <= 0) target.loadingProxy[key] = false
      target.errorProxy[key] = err
    },
  )
}
