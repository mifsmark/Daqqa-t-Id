PRAGMA foreign_keys = ON;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Requested','Quoted','WorkerAccepted','Confirmed','InProgress','Completed','Cancelled','Expired','Review','Test')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  url TEXT NOT NULL CHECK (url = '/dashboard' OR url GLOB '/bookings/[0-9a-fA-F-]*'),
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(source_event_id, recipient_id)
);
CREATE INDEX notifications_recipient_created_idx ON notifications(recipient_id, created_at DESC);
CREATE INDEX notifications_recipient_read_idx ON notifications(recipient_id, read_at, created_at DESC);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  session_id_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX push_subscriptions_session_idx ON push_subscriptions(session_id_hash);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id);
CREATE TRIGGER push_subscription_user_limit
BEFORE INSERT ON push_subscriptions
WHEN NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint_hash=NEW.endpoint_hash)
  AND (SELECT count(*) FROM push_subscriptions WHERE user_id=NEW.user_id) >= 5
BEGIN
  SELECT RAISE(ABORT, 'push_subscription_limit');
END;

CREATE TABLE push_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Leased','Sent','Dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
  due_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  last_status INTEGER,
  UNIQUE(notification_id, subscription_id)
);
CREATE INDEX push_deliveries_due_idx ON push_deliveries(status, due_at, lease_until);

CREATE TRIGGER notification_from_booking_history
AFTER INSERT ON booking_history
BEGIN
  INSERT OR IGNORE INTO notifications (id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
    CASE WHEN NEW.status = 'Requested' THEN w.user_id WHEN NEW.status IN ('Quoted','WorkerAccepted','InProgress','Completed') THEN b.customer_id
      WHEN NEW.status = 'Confirmed' THEN w.user_id WHEN NEW.status IN ('Cancelled','Expired') THEN b.customer_id END,
    b.id, NEW.id, NEW.status,
    CASE NEW.status WHEN 'Requested' THEN 'New service request' WHEN 'Quoted' THEN 'Booking update' WHEN 'WorkerAccepted' THEN 'Booking update'
      WHEN 'Confirmed' THEN 'Booking confirmed' WHEN 'InProgress' THEN 'Service in progress' WHEN 'Completed' THEN 'Service completed'
      WHEN 'Cancelled' THEN 'Booking cancelled' WHEN 'Expired' THEN 'Booking expired' END,
    CASE NEW.status WHEN 'Requested' THEN 'A customer sent you a service request.' WHEN 'Quoted' THEN 'Your service request has a new update.'
      WHEN 'WorkerAccepted' THEN 'Your service request has a new update.' WHEN 'Confirmed' THEN 'A customer confirmed your booking.'
      WHEN 'InProgress' THEN 'Your service has started.' WHEN 'Completed' THEN 'Your service is complete.'
      WHEN 'Cancelled' THEN 'A booking was cancelled.' WHEN 'Expired' THEN 'A booking expired.' END,
    '/bookings/' || b.id, NEW.at
  FROM bookings b JOIN workers w ON w.id=b.worker_id WHERE b.id=NEW.booking_id
    AND NEW.status IN ('Requested','Quoted','WorkerAccepted','Confirmed','InProgress','Completed','Cancelled','Expired');
  INSERT OR IGNORE INTO notifications (id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
    w.user_id,b.id,NEW.id,NEW.status,
    CASE NEW.status WHEN 'Cancelled' THEN 'Booking cancelled' WHEN 'Expired' THEN 'Booking expired' END,
    CASE NEW.status WHEN 'Cancelled' THEN 'A booking was cancelled.' WHEN 'Expired' THEN 'A booking expired.' END,
    '/bookings/' || b.id,NEW.at FROM bookings b JOIN workers w ON w.id=b.worker_id
  WHERE b.id=NEW.booking_id AND NEW.status IN ('Cancelled','Expired');
END;

CREATE TRIGGER notification_from_review
AFTER INSERT ON reviews
BEGIN
  INSERT OR IGNORE INTO notifications (id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
    w.user_id,NEW.booking_id,NEW.id,'Review','New customer review','A customer left you a review.','/bookings/' || NEW.booking_id,NEW.created_at
  FROM workers w WHERE w.id=NEW.worker_id;
END;

CREATE TRIGGER push_delivery_for_notification
AFTER INSERT ON notifications
BEGIN
  INSERT OR IGNORE INTO push_deliveries (id,notification_id,subscription_id,status,attempts,due_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
    NEW.id,s.id,'Pending',0,NEW.created_at FROM push_subscriptions s WHERE s.user_id=NEW.recipient_id;
END;
