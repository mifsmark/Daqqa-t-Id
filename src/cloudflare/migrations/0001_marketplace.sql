-- Cloudflare D1 marketplace schema. IDs are UUID strings, enum values are
-- their API spellings, timestamps are UTC ISO-8601 text, and money is cents.
PRAGMA foreign_keys = ON;

CREATE TABLE roles (
  name TEXT PRIMARY KEY CHECK (name IN ('Customer', 'Worker', 'Admin'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  security_stamp TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL REFERENCES roles(name),
  is_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0,1)),
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  requires_verification INTEGER NOT NULL DEFAULT 0 CHECK (requires_verification IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
CREATE TABLE category_modes (
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('ForMe','WithMe','TeachMe')),
  PRIMARY KEY (category_id, mode)
);

CREATE TABLE localities (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180)
);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL,
  years_experience INTEGER NOT NULL DEFAULT 0 CHECK (years_experience >= 0),
  radius_km REAL NOT NULL DEFAULT 10 CHECK (radius_km >= 0),
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_cents >= 0),
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('Hourly','Fixed','Quote')),
  verification_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (verification_status IN ('Unverified','Pending','Verified','Rejected','Suspended')),
  verification_reference TEXT,
  verification_notes TEXT,
  available_now INTEGER NOT NULL DEFAULT 0 CHECK (available_now IN (0,1)),
  availability_updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX workers_locality_idx ON workers(locality);
CREATE INDEX workers_verification_status_idx ON workers(verification_status);

CREATE TABLE offerings (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('Hourly','Fixed','Quote')),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  UNIQUE (worker_id, category_id)
);
CREATE INDEX offerings_category_id_idx ON offerings(category_id);
CREATE TABLE offering_modes (
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('ForMe','WithMe','TeachMe')),
  PRIMARY KEY (offering_id, mode)
);

CREATE TABLE weekly_hours (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  CHECK (start_time < end_time)
);
CREATE INDEX weekly_hours_worker_weekday_idx ON weekly_hours(worker_id, weekday);
CREATE TABLE availability_exceptions (
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  is_available INTEGER NOT NULL CHECK (is_available IN (0,1)),
  PRIMARY KEY (worker_id, date)
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('ForMe','WithMe','TeachMe')),
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL,
  private_address TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Quoted','WorkerAccepted','Confirmed','InProgress','Completed','Cancelled','Expired')),
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('Hourly','Fixed','Quote')),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  commission_cents INTEGER CHECK (commission_cents IS NULL OR commission_cents >= 0),
  quote_amount_cents INTEGER CHECK (quote_amount_cents IS NULL OR quote_amount_cents >= 0),
  is_asap INTEGER NOT NULL DEFAULT 0 CHECK (is_asap IN (0,1)),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  is_simulated INTEGER NOT NULL DEFAULT 1 CHECK (is_simulated = 1),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (customer_id, idempotency_key),
  CHECK (start_at < end_at)
);
CREATE INDEX bookings_worker_schedule_idx ON bookings(worker_id, status, start_at, end_at);
CREATE INDEX bookings_customer_created_idx ON bookings(customer_id, created_at);
CREATE INDEX bookings_worker_created_idx ON bookings(worker_id, created_at);
CREATE INDEX bookings_category_idx ON bookings(category_id);

CREATE TABLE booking_history (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('Requested','Quoted','WorkerAccepted','Confirmed','InProgress','Completed','Cancelled','Expired')),
  at TEXT NOT NULL
);
CREATE INDEX booking_history_booking_at_idx ON booking_history(booking_id, at);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  commission_cents INTEGER NOT NULL CHECK (commission_cents >= 0),
  is_simulated INTEGER NOT NULL DEFAULT 1 CHECK (is_simulated = 1),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE payment_ledger (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('Gross','Commission')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (payment_id, kind)
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX reviews_worker_created_idx ON reviews(worker_id, created_at);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('avatar','portfolio','booking')),
  booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0)
);
CREATE INDEX media_owner_purpose_idx ON media(owner_id, purpose);

CREATE TABLE privacy_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('Export','Delete')),
  status TEXT NOT NULL DEFAULT 'Open',
  created_at TEXT NOT NULL
);
CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_entries_created_idx ON audit_entries(created_at);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  commission_bps INTEGER NOT NULL DEFAULT 1200 CHECK (commission_bps BETWEEN 0 AND 10000)
);

CREATE TABLE customer_addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  locality TEXT NOT NULL
);
CREATE INDEX customer_addresses_user_idx ON customer_addresses(user_id);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id);

-- Operators may populate this table with an explicit staging marker. The base
-- migration intentionally leaves it empty so normal databases cannot be
-- mistaken for isolated staging-demo environments.
CREATE TABLE deployment_info (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Booking validation runs inside SQLite's write transaction. Schedule window
-- and exception evaluation is performed by the service using workers.version
-- as a compare-and-swap guard before it inserts or reserves a booking.
CREATE TRIGGER bookings_validate_insert
BEFORE INSERT ON bookings
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.customer_id AND u.is_suspended = 1
  ) THEN RAISE(ABORT, 'customer_suspended') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM workers w JOIN users u ON u.id = w.user_id
    WHERE w.id = NEW.worker_id AND (u.is_suspended = 1 OR w.verification_status = 'Suspended')
  ) THEN RAISE(ABORT, 'worker_suspended') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM categories c JOIN category_modes cm ON cm.category_id = c.id
    WHERE c.id = NEW.category_id AND c.is_active = 1 AND cm.mode = NEW.mode
  ) THEN RAISE(ABORT, 'category_mode_unavailable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM offerings o JOIN offering_modes om ON om.offering_id = o.id
    WHERE o.worker_id = NEW.worker_id AND o.category_id = NEW.category_id AND om.mode = NEW.mode
  ) THEN RAISE(ABORT, 'worker_offering_unavailable') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM categories c JOIN workers w ON w.id = NEW.worker_id
    WHERE c.id = NEW.category_id AND c.requires_verification = 1 AND w.verification_status <> 'Verified'
  ) THEN RAISE(ABORT, 'worker_verification_required') END;
  SELECT CASE WHEN NEW.is_asap = 1 AND NOT EXISTS (
    SELECT 1 FROM workers w WHERE w.id = NEW.worker_id AND w.available_now = 1
  ) THEN RAISE(ABORT, 'worker_not_available_now') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM bookings b WHERE b.worker_id = NEW.worker_id
      AND b.status IN ('WorkerAccepted','Confirmed','InProgress')
      AND NEW.start_at < b.end_at AND b.start_at < NEW.end_at
  ) THEN RAISE(ABORT, 'worker_time_conflict') END;
END;

CREATE TRIGGER bookings_validate_update
BEFORE UPDATE ON bookings
BEGIN
  SELECT CASE WHEN NEW.version <> OLD.version + 1
    THEN RAISE(ABORT, 'booking_version_conflict') END;
  SELECT CASE WHEN NOT (
    (OLD.status = 'Requested' AND NEW.status IN ('Quoted','WorkerAccepted','Cancelled','Expired')) OR
    (OLD.status = 'Quoted' AND NEW.status IN ('Confirmed','Cancelled','Expired')) OR
    (OLD.status = 'WorkerAccepted' AND NEW.status IN ('Confirmed','Cancelled','Expired')) OR
    (OLD.status = 'Confirmed' AND NEW.status IN ('InProgress','Cancelled')) OR
    (OLD.status = 'InProgress' AND NEW.status = 'Completed') OR
    (OLD.status = NEW.status)
  ) THEN RAISE(ABORT, 'invalid_booking_transition') END;
  SELECT CASE WHEN NEW.status = 'Completed' AND (NEW.amount_cents IS NULL OR NEW.commission_cents IS NULL)
    THEN RAISE(ABORT, 'completion_amount_required') END;
  SELECT CASE WHEN NEW.status IN ('WorkerAccepted','Confirmed','InProgress') AND EXISTS (
    SELECT 1 FROM bookings b WHERE b.id <> NEW.id AND b.worker_id = NEW.worker_id
      AND b.status IN ('WorkerAccepted','Confirmed','InProgress')
      AND NEW.start_at < b.end_at AND b.start_at < NEW.end_at
  ) THEN RAISE(ABORT, 'worker_time_conflict') END;
  SELECT CASE WHEN NEW.status IN ('WorkerAccepted','Confirmed','InProgress') AND (
    EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.customer_id AND u.is_suspended = 1) OR
    EXISTS (SELECT 1 FROM users u JOIN workers w ON w.user_id = u.id WHERE w.id = NEW.worker_id AND (u.is_suspended = 1 OR w.verification_status = 'Suspended')) OR
    NOT EXISTS (SELECT 1 FROM categories c JOIN category_modes cm ON cm.category_id = c.id WHERE c.id = NEW.category_id AND c.is_active = 1 AND cm.mode = NEW.mode) OR
    NOT EXISTS (SELECT 1 FROM offerings o JOIN offering_modes om ON om.offering_id = o.id WHERE o.worker_id = NEW.worker_id AND o.category_id = NEW.category_id AND om.mode = NEW.mode) OR
    EXISTS (SELECT 1 FROM categories c JOIN workers w ON w.id = NEW.worker_id WHERE c.id = NEW.category_id AND c.requires_verification = 1 AND w.verification_status <> 'Verified')
  ) THEN RAISE(ABORT, 'booking_eligibility_changed') END;
END;

CREATE TRIGGER bookings_history_insert
AFTER INSERT ON bookings
BEGIN
  INSERT INTO booking_history (id, booking_id, status, at)
  VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), NEW.id, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER bookings_history_update
AFTER UPDATE OF status ON bookings
WHEN NEW.status <> OLD.status
BEGIN
  INSERT INTO booking_history (id, booking_id, status, at)
  VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), NEW.id, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER bookings_simulated_payment
AFTER UPDATE OF status ON bookings
WHEN OLD.status <> 'Completed' AND NEW.status = 'Completed'
BEGIN
  INSERT INTO payments (id, booking_id, amount_cents, commission_cents, is_simulated, status, created_at)
  VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), NEW.id, NEW.amount_cents, NEW.commission_cents, 1, 'Succeeded', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  INSERT INTO payment_ledger (id, payment_id, kind, amount_cents, created_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), p.id, 'Gross', p.amount_cents, p.created_at
  FROM payments p WHERE p.booking_id = NEW.id;
  INSERT INTO payment_ledger (id, payment_id, kind, amount_cents, created_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), p.id, 'Commission', p.commission_cents, p.created_at
  FROM payments p WHERE p.booking_id = NEW.id;
END;

INSERT OR IGNORE INTO roles (name) VALUES ('Customer'), ('Worker'), ('Admin');
INSERT OR IGNORE INTO settings (id, commission_bps) VALUES (1, 1200);

INSERT OR IGNORE INTO categories (id, slug, name, description, icon, requires_verification, is_active) VALUES
('73d55a76-19e5-5d7e-9820-70b55ac49358','plumbing','Plumbing','Repairs and installations by verified plumbers. Customers cannot participate in hazardous plumbing work.','wrench',1,1),
('24641d4d-9f73-5add-9894-9806316dfef4','electrical','Electrical','Electrical repairs and installations by verified electricians. Customers cannot participate in electrical work.','bolt',1,1),
('174f21df-55ab-5467-9f57-5ca5e2e0f0ab','cleaning','Cleaning','Home and workplace cleaning. WithMe and TeachMe are limited to safe, non-hazardous tasks.','sparkles',0,1),
('56ee7a88-5da7-595e-b14d-1a6d5887aa4c','handyman','Handyman','Minor non-regulated repairs and maintenance. No electrical, plumbing, structural or hazardous work; participation must stay clear of tools and hazards.','hammer',0,1),
('617b81e6-ced6-5219-8476-7d119f29783d','furniture-assembly','Furniture assembly','Furniture assembly and setup. TeachMe and WithMe exclude power-tool operation, heavy lifting and hazardous tasks.','package',0,1),
('e4d22e5c-c61c-5cf3-aade-8ca61cb87787','painting','Painting','Interior painting and preparation. Participation is limited to safe, reachable areas without hazardous coatings or equipment.','paintbrush',0,1),
('98b9a980-b62b-5a03-a2d6-2d78d78fcd24','tiling','Tiling','Tile repairs and installation. Cutting, hazardous materials and power-tool operation are worker-only tasks.','grid-3x3',0,1),
('2bcfdaf5-27ce-55d7-807d-d10c79d40b8a','gardening','Gardening','Garden care and planting. Power tools, chemicals and other hazardous tasks are worker-only.','leaf',0,1),
('bdb9a94a-9c0a-501d-95ad-61736c8f1a3f','moving-lifting','Moving and lifting','Moving assistance and safe lifting support. Heavy or hazardous lifts remain worker-only; TeachMe covers safe planning and technique.','move',0,1),
('2e883fb3-e2ff-55f7-8a12-784541dedaaa','home-maintenance','Home maintenance','Routine non-regulated home maintenance. No hazardous, structural, plumbing or electrical work; participation stays clear of tools and risks.','home',0,1);

INSERT OR IGNORE INTO category_modes (category_id, mode)
SELECT id, 'ForMe' FROM categories WHERE slug IN (
  'plumbing','electrical','cleaning','handyman','furniture-assembly','painting','tiling','gardening','moving-lifting','home-maintenance'
);
INSERT OR IGNORE INTO category_modes (category_id, mode)
SELECT id, mode FROM categories, (SELECT 'WithMe' AS mode UNION ALL SELECT 'TeachMe')
WHERE slug IN ('cleaning','handyman','furniture-assembly','painting','tiling','gardening','moving-lifting','home-maintenance');

INSERT OR IGNORE INTO localities (name, latitude, longitude) VALUES
('Valletta',35.8992,14.5141),('Sliema',35.9122,14.5042),('St Julian''s',35.9184,14.4891),('St. Julian''s',35.9184,14.4891),
('Swieqi',35.9200,14.4800),('Naxxar',35.9130,14.4430),('Mellieha',35.9560,14.3620),('Mosta',35.9090,14.4256),
('Birkirkara',35.8972,14.4611),('Rabat',35.8815,14.3988),('Mdina',35.8858,14.4031),('Marsaxlokk',35.8417,14.5447),
('Victoria',36.0444,14.2397),('Xlendi',36.0296,14.2170),('Nadur',36.0378,14.2940);
