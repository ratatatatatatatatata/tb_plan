-- Review schema for a dedicated Cloudflare D1 database on Workers FREE.
-- Not applied to an account. No Supabase/PostgreSQL or paid bindings required.
PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, minute INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE INDEX rate_limits_minute_idx ON rate_limits(minute);
CREATE TABLE courses (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
  price_mnt INTEGER CHECK(price_mnt BETWEEN 1 AND 1000000000),
  access_days INTEGER CHECK(access_days BETWEEN 1 AND 3650),
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN(0,1)),
  enrollment_open INTEGER NOT NULL DEFAULT 0 CHECK(enrollment_open IN(0,1)),
  CHECK(enrollment_open=0 OR (published=1 AND price_mnt IS NOT NULL))
);
CREATE TABLE modules (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id),title TEXT NOT NULL,sort_order INTEGER NOT NULL,
  UNIQUE(id,course_id),UNIQUE(course_id,sort_order)
);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),module_id TEXT NOT NULL,
  slug TEXT NOT NULL,title TEXT NOT NULL,objective TEXT NOT NULL DEFAULT '',duration_seconds INTEGER CHECK(duration_seconds>0),
  sort_order INTEGER NOT NULL,is_preview INTEGER NOT NULL DEFAULT 0 CHECK(is_preview IN(0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN(0,1)),
  UNIQUE(id,course_id),UNIQUE(course_id,slug),UNIQUE(course_id,sort_order),
  FOREIGN KEY(module_id,course_id) REFERENCES modules(id,course_id)
);
CREATE TABLE lesson_assets (
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id),
  media_path TEXT UNIQUE CHECK(media_path LIKE '/hicheel/private/%.mp4'),
  captions_path TEXT UNIQUE CHECK(captions_path LIKE '/hicheel/private/%.vtt'),
  media_bytes INTEGER CHECK(media_bytes BETWEEN 1 AND 26214400),
  worksheet_text TEXT NOT NULL DEFAULT '',
  quiz_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(quiz_json) AND json_type(quiz_json)='array')
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),course_id TEXT NOT NULL REFERENCES courses(id),
  reference TEXT NOT NULL UNIQUE,amount_mnt INTEGER NOT NULL CHECK(amount_mnt BETWEEN 1 AND 1000000000),
  access_days INTEGER CHECK(access_days BETWEEN 1 AND 3650),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','paid','revoked','cancelled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),paid_at INTEGER
);
CREATE UNIQUE INDEX one_pending_order ON orders(user_id,course_id) WHERE status='pending';
CREATE INDEX orders_user_idx ON orders(user_id,created_at);
CREATE TABLE manual_payments (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),bank_reference TEXT NOT NULL UNIQUE,
  amount_mnt INTEGER NOT NULL CHECK(amount_mnt>0),confirmed_by TEXT NOT NULL REFERENCES users(id),
  confirmed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE entitlements (
  user_id TEXT NOT NULL REFERENCES users(id),course_id TEXT NOT NULL REFERENCES courses(id),
  order_id TEXT NOT NULL REFERENCES orders(id),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  expires_at INTEGER,granted_at INTEGER NOT NULL DEFAULT (unixepoch()),PRIMARY KEY(user_id,course_id)
);
CREATE INDEX entitlements_order_idx ON entitlements(order_id);
CREATE TABLE progress (
  user_id TEXT NOT NULL REFERENCES users(id),lesson_id TEXT NOT NULL,course_id TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0 CHECK(position_seconds>=0 AND position_seconds<86400),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(user_id,lesson_id),FOREIGN KEY(lesson_id,course_id) REFERENCES lessons(id,course_id)
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),actor_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK(event_type IN('manual_payment_confirmed','access_revoked')),
  note TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL DEFAULT (unixepoch()),UNIQUE(order_id,event_type)
);

-- A payment insertion and entitlement grant are one SQLite statement/transaction.
-- Only the Worker administrator route can insert; D1 has no public REST table API.
CREATE TRIGGER validate_manual_payment BEFORE INSERT ON manual_payments BEGIN
  SELECT RAISE(ABORT,'ORDER_NOT_PENDING') WHERE NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status='pending');
  SELECT RAISE(ABORT,'PAYMENT_AMOUNT_MISMATCH') WHERE NEW.amount_mnt<>(SELECT amount_mnt FROM orders WHERE id=NEW.order_id);
END;
CREATE TRIGGER grant_manual_payment AFTER INSERT ON manual_payments BEGIN
  UPDATE orders SET status='paid',paid_at=unixepoch() WHERE id=NEW.order_id;
  INSERT INTO entitlements(user_id,course_id,order_id,active,expires_at)
    SELECT user_id,course_id,id,1,CASE WHEN access_days IS NULL THEN NULL ELSE unixepoch()+access_days*86400 END
      FROM orders WHERE id=NEW.order_id
    ON CONFLICT(user_id,course_id) DO UPDATE SET order_id=excluded.order_id,active=1,granted_at=unixepoch(),
      expires_at=CASE WHEN entitlements.active=1 AND entitlements.expires_at IS NULL THEN NULL
        WHEN excluded.expires_at IS NULL THEN NULL ELSE max(coalesce(entitlements.expires_at,0),excluded.expires_at) END;
  INSERT INTO audit_events(id,order_id,actor_id,event_type)
    VALUES(lower(hex(randomblob(16))),NEW.order_id,NEW.confirmed_by,'manual_payment_confirmed');
END;
CREATE TRIGGER revoke_order_access AFTER UPDATE OF status ON orders WHEN NEW.status='revoked' BEGIN
  UPDATE entitlements SET active=0 WHERE order_id=NEW.id;
END;
