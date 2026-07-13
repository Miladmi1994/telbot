PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS global_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_income INTEGER NOT NULL DEFAULT 0,
    successful_sales INTEGER NOT NULL DEFAULT 0,
    abandoned_carts INTEGER NOT NULL DEFAULT 0,
    test_to_buy_conversion INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sales_open INTEGER NOT NULL DEFAULT 1,
    maintenance INTEGER NOT NULL DEFAULT 0,
    active_server_id TEXT,
    active_vip_server_id TEXT,
    crisis_mode INTEGER NOT NULL DEFAULT 0,
    crisis_config TEXT
);

CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gb INTEGER NOT NULL,
    days INTEGER NOT NULL,
    price INTEGER NOT NULL,
    btn_text TEXT NOT NULL,
    sold INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER,
    show_in_new INTEGER,
    show_in_renew INTEGER,
    target_user_id TEXT
);

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    panel_url TEXT NOT NULL,
    web_base_path TEXT NOT NULL DEFAULT '',
    api_token TEXT NOT NULL,
    inbound_id INTEGER NOT NULL DEFAULT 1,
    domain TEXT NOT NULL,
    sni TEXT NOT NULL,
    path TEXT NOT NULL,
    is_migrating INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admins (
    telegram_id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    has_used_test INTEGER NOT NULL DEFAULT 0,
    is_vip INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_stats (
    telegram_id TEXT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
    total_spent INTEGER NOT NULL DEFAULT 0,
    buy_count INTEGER NOT NULL DEFAULT 0,
    renew_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    email TEXT NOT NULL,
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    server_id TEXT,
    order_id TEXT,
    is_vip INTEGER NOT NULL DEFAULT 0,
    deleted_from_panel INTEGER NOT NULL DEFAULT 0,
    notified_days3 INTEGER NOT NULL DEFAULT 0,
    notified_gb85 INTEGER NOT NULL DEFAULT 0,
    notified_gb1 INTEGER NOT NULL DEFAULT 0,
    panel_total INTEGER,
    panel_used INTEGER,
    panel_expiry INTEGER,
    panel_email TEXT
);

CREATE TABLE IF NOT EXISTS payments (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    plan_id TEXT NOT NULL,
    email TEXT,
    order_id TEXT,
    config_name TEXT,
    type TEXT NOT NULL
);

INSERT OR IGNORE INTO global_stats (id) VALUES (1);
INSERT OR IGNORE INTO settings (id) VALUES (1);
