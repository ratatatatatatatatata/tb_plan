// One free hourly Cron invocation; not deployed by this patch. Indexed predicates
// and at most 500 deletes per table keep each run and its write budget bounded.
export async function maintenance(env){
  if(env.FREE_MODE!=='1'||!env.DB)throw new Error('Free database not configured');
  const now=Math.floor(Date.now()/1000),oldMinute=Math.floor(now/60)-1440;
  return env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE key IN(SELECT key FROM rate_limits WHERE minute<? ORDER BY minute LIMIT 500)').bind(oldMinute),
    env.DB.prepare('DELETE FROM sessions WHERE token_hash IN(SELECT token_hash FROM sessions WHERE expires_at<? ORDER BY expires_at LIMIT 500)').bind(now)
  ]);
}
