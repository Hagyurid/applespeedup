declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APLUS_WRITES_ENABLED?: string;
  }
}
