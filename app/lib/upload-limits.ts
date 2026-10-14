/**
 * Vercel refuses request bodies above 4.5 MB before the function even runs. One upload (all files together) stays
 * below that, and the browser checks it first, so nobody meets the platform's bare 413. Bigger batches would go
 * straight to object storage instead; see README, "Grenzen".
 */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 20;
