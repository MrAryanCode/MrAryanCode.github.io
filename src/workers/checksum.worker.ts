// Module worker: counts primes below a limit. A stand-in for any CPU work worth moving off the main thread.
export interface CountRequest { limit: number }
export interface CountResult { primes: number; ms: number }

self.onmessage = (event: MessageEvent<CountRequest>) => {
  const t0 = performance.now();
  const n = event.data.limit;
  const sieve = new Uint8Array(n + 1);
  let primes = 0;
  for (let i = 2; i <= n; i++) {
    if (sieve[i]) continue;
    primes++;
    for (let j = i * 2; j <= n; j += i) sieve[j] = 1;
  }
  const result: CountResult = { primes, ms: Math.round(performance.now() - t0) };
  self.postMessage(result);
};
