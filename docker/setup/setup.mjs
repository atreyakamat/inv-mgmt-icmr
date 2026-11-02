// One-shot setup for the offline stack:
//   1. apply supabase/migrations (tracked, so re-runs are no-ops)
//   2. create one demo account per role (via the real Auth admin API)
//   3. seed catalog, stock and requests by running the real workflow
//      functions as those people, then spread the history over past weeks
//
// Safe to re-run: seeding is skipped once demo accounts exist.

import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { DATABASE_URL, ADMIN_DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD, DEMO_TOTP_SECRET } = process.env;
const MIGRATIONS = "/migrations";
const DOMAIN = "inventory.local";

const log = (...a) => console.log("[setup]", ...a);

// ------------------------------------------------------------------ db helpers
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
const adminPool = new pg.Pool({ connectionString: ADMIN_DATABASE_URL, max: 1 });

async function withClient(fn) {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

async function retry(label, fn, tries = 60) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries) throw e;
      if (i === 1 || i % 10 === 0) log(`waiting for ${label}… (${e.message})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ------------------------------------------------------------------ 1. migrations
async function migrate() {
  await retry("database", () => pool.query("select 1"));
  await retry("auth schema", async () => {
    const { rows } = await pool.query("select to_regclass('auth.users') as t, to_regclass('auth.mfa_factors') as m");
    if (!rows[0].t || !rows[0].m) throw new Error("auth tables not created yet");
  });

  await pool.query(`create schema if not exists _local;
    create table if not exists _local.migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pool.query("select name from _local.migrations")).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();

  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(`${MIGRATIONS}/${f}`, "utf8");
    await withClient(async (c) => {
      await c.query("begin");
      try {
        await c.query(sql);
        await c.query("insert into _local.migrations (name) values ($1)", [f]);
        await c.query("commit");
        log("applied", f);
      } catch (e) {
        await c.query("rollback");
        throw new Error(`migration ${f} failed: ${e.message}`);
      }
    });
  }
  await pool.query("notify pgrst, 'reload schema'");
}

// ------------------------------------------------------------------ 2. accounts
const people = [
  { key: "admin",     email: `admin@${DOMAIN}`,     name: "Atreya Kamat",     role: "admin" },
  { key: "super",     email: `super@${DOMAIN}`,     name: "Dr. Priya Naik",   role: "super_user" },
  { key: "validator", email: `validator@${DOMAIN}`, name: "Rohan Dessai",     role: "validator" },
  { key: "store",     email: `store@${DOMAIN}`,     name: "Meera Kamat",      role: "store_manager" },
  { key: "anil",      email: `anil@${DOMAIN}`,      name: "Anil Sawant",      role: "user" },
  { key: "sneha",     email: `sneha@${DOMAIN}`,     name: "Sneha Gaonkar",    role: "user" },
  { key: "kevin",     email: `kevin@${DOMAIN}`,     name: "Kevin Fernandes",  role: "user" },
];

async function createAccounts() {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await retry("auth API", async () => {
    const { error } = await admin.auth.admin.listUsers({ perPage: 1 });
    if (error) throw error;
  });

  const ids = {};
  for (const p of people) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: p.name },
    });
    if (error) throw new Error(`create ${p.email}: ${error.message}`);
    ids[p.key] = data.user.id;
  }

  await pool.query(
    `insert into inventory.profiles (id, email, full_name, role_id)
     select x.id::uuid, x.email, x.name, r.id
     from jsonb_to_recordset($1::jsonb) as x(id text, email text, name text, role text)
     join inventory.roles r on r.key = x.role`,
    [JSON.stringify(people.map((p) => ({ id: ids[p.key], email: p.email, name: p.name, role: p.role })))],
  );
  log(`created ${people.length} demo accounts`);

  // Demo convenience: every demo account shares one authenticator key, so a
  // single entry in your authenticator app signs in as any of them. Anyone
  // invited through People still goes through the normal enrolment.
  if (DEMO_TOTP_SECRET) {
    await adminPool.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at)
       select gen_random_uuid(), u::uuid, 'Store register (demo)', 'totp', 'verified', $2, now(), now()
       from unnest($1::text[]) as u`,
      [Object.values(ids), DEMO_TOTP_SECRET],
    );
    log("demo accounts share one authenticator key (see README)");
  }
  return ids;
}

// ------------------------------------------------------------------ 3. seed
// Deterministic randomness so every fresh stack looks the same.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261025);
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

/**
 * Runs `fn` as a member (JWT claims with MFA done, role authenticated), in its
 * own transaction, then moves every timestamp it wrote to `when`. This keeps
 * the audit trail and request timelines looking like real history.
 */
async function as(userId, when, fn) {
  return withClient(async (c) => {
    const { rows: [{ t0 }] } = await c.query("select clock_timestamp() as t0");
    await c.query("begin");
    let result;
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated", aal: "aal2" }),
      ]);
      await c.query("set local role authenticated");
      result = await fn(c);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
    const { rows: [{ t1 }] } = await c.query("select clock_timestamp() as t1");
    await shiftTime(t0, t1, when);
    return result;
  });
}

const timeColumns = {
  "inventory.categories": ["created_at", "updated_at"],
  "inventory.locations": ["created_at", "updated_at"],
  "inventory.items": ["created_at", "updated_at"],
  "inventory.requests": ["created_at", "updated_at", "reviewed_at", "approved_at", "closed_at"],
  "inventory.request_events": ["created_at"],
  "inventory.stock_movements": ["created_at"],
  "inventory.stock_levels": ["updated_at"],
  "inventory.audit_log": ["created_at"],
};

async function shiftTime(t0, t1, when) {
  // Seed-only: the ledger and audit log are append-only, so their guard
  // triggers are bypassed (superuser, replica mode) for this one bulk re-dating.
  const c = await adminPool.connect();
  try {
  await c.query("begin");
  await c.query("set local session_replication_role = replica");
  const delta = `${(when.getTime() - new Date(t0).getTime()) / 1000} seconds`;
  for (const [table, cols] of Object.entries(timeColumns)) {
    for (const col of cols) {
      await c.query(
        `update ${table} set ${col} = ${col} + $1::interval where ${col} >= $2 and ${col} <= $3`,
        [delta, t0, t1],
      );
    }
  }
  await c.query("commit");
  } finally {
    c.release();
  }
}

const daysAgo = (d, hour = 10, minute = 0) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  t.setUTCHours(hour - 5, minute - 30 + between(0, 50), between(0, 59), 0); // IST working hours
  return t;
};

const catalog = {
  categories: [
    ["Lab consumables", "Single-use plastics and disposables"],
    ["Glassware", "Reusable glass and measuring ware"],
    ["Reagents & chemicals", "Stains, buffers, solvents"],
    ["PPE", "Personal protective equipment"],
    ["Stationery", "Office and lab notebooks, labels, pens"],
    ["IT & electrical", "Cables, batteries, small electronics"],
  ],
  locations: [
    ["Main store", "Ground floor store room"],
    ["Lab 1 – Microbiology", "First floor, east wing"],
    ["Lab 2 – Molecular biology", "First floor, west wing"],
    ["Cold room", "4 °C walk-in, reagents only"],
  ],
  // [sku, name, category index, unit, reorder level, opening stock at main store]
  items: [
    ["PIP-10", "Pipette tips 10 µl", 0, "rack", 10, 60],
    ["PIP-200", "Pipette tips 200 µl", 0, "rack", 10, 45],
    ["PIP-1000", "Pipette tips 1000 µl", 0, "rack", 8, 30],
    ["TUBE-15", "Centrifuge tubes 15 ml", 0, "pack", 6, 25],
    ["TUBE-50", "Centrifuge tubes 50 ml", 0, "pack", 6, 18],
    ["EPP-1.5", "Microcentrifuge tubes 1.5 ml", 0, "pack", 5, 40],
    ["PETRI-90", "Petri dishes 90 mm", 0, "sleeve", 10, 22],
    ["SLIDE", "Microscope slides", 0, "box", 5, 14],
    ["COVER", "Cover slips 22×22", 0, "box", 4, 9],
    ["BKR-250", "Beaker 250 ml", 1, "pcs", 4, 16],
    ["BKR-1000", "Beaker 1 L", 1, "pcs", 2, 6],
    ["FLASK-500", "Conical flask 500 ml", 1, "pcs", 4, 12],
    ["CYL-100", "Measuring cylinder 100 ml", 1, "pcs", 2, 5],
    ["BOTTLE-1L", "Reagent bottle 1 L", 1, "pcs", 3, 10],
    ["ETOH-70", "Ethanol 70%", 2, "L", 10, 40],
    ["IPA", "Isopropanol", 2, "L", 5, 12],
    ["PBS", "PBS buffer 10×", 2, "bottle", 3, 8],
    ["AGAR", "Nutrient agar", 2, "kg", 2, 4],
    ["GRAM", "Gram stain kit", 2, "kit", 2, 3],
    ["TAQ", "Taq master mix", 2, "kit", 2, 5],
    ["GLV-S", "Nitrile gloves (S)", 3, "box", 10, 30],
    ["GLV-M", "Nitrile gloves (M)", 3, "box", 15, 50],
    ["GLV-L", "Nitrile gloves (L)", 3, "box", 10, 20],
    ["MASK-N95", "N95 respirator", 3, "box", 4, 10],
    ["COAT", "Lab coat (disposable)", 3, "pcs", 10, 35],
    ["GOGGLE", "Safety goggles", 3, "pcs", 3, 8],
    ["NB-LAB", "Lab notebook A4", 4, "pcs", 5, 25],
    ["LABEL-CRYO", "Cryo labels", 4, "roll", 3, 10],
    ["MARKER", "Permanent markers", 4, "pack", 4, 15],
    ["PAPER-A4", "Printer paper A4", 4, "ream", 10, 40],
    ["BATT-AA", "AA batteries", 5, "pack", 4, 12],
    ["EXT-CORD", "Extension cord 5 m", 5, "pcs", 2, 4],
  ],
};

async function seed(ids) {
  const { store, super: superUser, validator, anil, sneha, kevin } = ids;

  // ---- catalog (store manager, ~6 weeks ago)
  const cat = await as(store, daysAgo(45, 10), async (c) => {
    const out = [];
    for (const [name, description] of catalog.categories) {
      out.push((await c.query("insert into inventory.categories (name, description) values ($1, $2) returning id", [name, description])).rows[0].id);
    }
    return out;
  });
  const loc = await as(store, daysAgo(45, 11), async (c) => {
    const out = [];
    for (const [name, description] of catalog.locations) {
      out.push((await c.query("insert into inventory.locations (name, description) values ($1, $2) returning id", [name, description])).rows[0].id);
    }
    return out;
  });
  const [MAIN, LAB1, LAB2, COLD] = loc;
  const items = await as(store, daysAgo(44, 15), async (c) => {
    const out = [];
    for (const [sku, name, ci, unit, reorder] of catalog.items) {
      const { rows } = await c.query(
        "insert into inventory.items (sku, name, category_id, unit, reorder_level) values ($1, $2, $3, $4, $5) returning id",
        [sku, name, cat[ci], unit, reorder],
      );
      out.push({ id: rows[0].id, sku, name, unit, reorder, opening: catalog.items.find((x) => x[0] === sku)[5] });
    }
    return out;
  });
  const bySku = Object.fromEntries(items.map((i) => [i.sku, i]));
  const coldSkus = new Set(["PBS", "TAQ", "AGAR"]);

  // ---- opening stock count
  await as(store, daysAgo(43, 11), async (c) => {
    for (const i of items) {
      await c.query("select inventory.receive_stock($1, $2, $3, $4)", [
        i.id, coldSkus.has(i.sku) ? COLD : MAIN, i.opening, "Opening stock count",
      ]);
    }
  });

  // ---- stock out to the labs
  const labStock = ["PIP-10", "PIP-200", "GLV-M", "GLV-S", "ETOH-70", "EPP-1.5", "PETRI-90", "COAT"];
  await as(store, daysAgo(40, 12), async (c) => {
    for (const sku of labStock) {
      const i = bySku[sku];
      await c.query("select inventory.transfer_stock($1, $2, $3, $4, $5)", [i.id, MAIN, LAB1, between(3, 6), "Working stock for Lab 1"]);
      await c.query("select inventory.transfer_stock($1, $2, $3, $4, $5)", [i.id, MAIN, LAB2, between(3, 6), "Working stock for Lab 2"]);
    }
  });

  // ---- a supplier delivery and two count corrections
  await as(store, daysAgo(21, 14), async (c) => {
    for (const sku of ["GLV-M", "PIP-200", "TUBE-50", "PAPER-A4"]) {
      await c.query("select inventory.receive_stock($1, $2, $3, $4)", [bySku[sku].id, MAIN, between(10, 20), "PO 2026/118 — Goa Scientific Supplies"]);
    }
  });
  await as(store, daysAgo(14, 17), (c) =>
    c.query("select inventory.adjust_stock($1, $2, $3, $4)", [bySku["BKR-250"].id, MAIN, -2, "Two beakers cracked during washing"]));
  await as(store, daysAgo(7, 16), (c) =>
    c.query("select inventory.adjust_stock($1, $2, $3, $4)", [bySku["MARKER"].id, MAIN, 1, "Found an extra pack during monthly count"]));

  // ---- requests across every stage of the workflow
  const requesters = [anil, sneha, kevin, validator, store];
  const purposes = [
    "Weekly consumables for the bacterial culture work",
    "PCR setup for the dengue serotyping batch",
    "Restock after the training session for interns",
    "Sample processing for the field survey samples from Ponda",
    "Media preparation for next week's plating",
    "Gram staining practicals",
    "Replacing broken glassware in Lab 2",
    "Documentation for the quarterly audit",
    "Cold-chain reagents for the outreach camp",
    "PPE for the sputum sample handling rota",
    "Printer paper and labels for the sample register",
    "Extraction run for the TB study",
    "Backup batteries for the field thermometers",
    "Glassware for the new buffer preparations",
    "Consumables for the visiting researcher",
    "Extra gloves for the monsoon surveillance backlog",
    "Pipette tips for the ELISA plates",
    "Lab coats for the new joiners",
  ];
  const plans = [
    // [final status, days ago raised]
    ["fulfilled", 38], ["fulfilled", 33], ["fulfilled", 29], ["rejected", 27], ["fulfilled", 24],
    ["fulfilled", 19], ["cancelled", 17], ["fulfilled", 15], ["rejected_store", 12], ["fulfilled", 10],
    ["approved", 6], ["not_recommended", 5], ["approved", 4], ["recommended", 3],
    ["recommended", 2], ["submitted", 1], ["submitted", 1], ["submitted", 0],
  ];
  const destFor = () => pick([MAIN, MAIN, LAB1, LAB2]);

  for (let n = 0; n < plans.length; n++) {
    const [finalStatus, d] = plans[n];
    // A validator cannot review their own request, so they only raise ones that stay "submitted".
    let requester = requesters[n % requesters.length];
    if (requester === validator && !["submitted", "cancelled"].includes(finalStatus)) requester = anil;
    const location = destFor();
    // Lines: 1–4 items that actually sit at that location (so hand-over works).
    const { rows: available } = await pool.query(
      "select item_id, quantity from inventory.stock_levels where location_id = $1 and quantity >= 4 order by item_id", [location]);
    const shuffled = available.sort(() => rand() - 0.5).slice(0, between(1, Math.min(4, available.length)));
    const lines = shuffled.map((r) => ({ item_id: Number(r.item_id), quantity: between(1, Math.max(1, Math.floor(r.quantity / 4))) }));
    if (lines.length === 0) continue;

    const id = await as(requester, daysAgo(d, between(9, 12)), async (c) => {
      const { rows } = await c.query("select inventory.submit_request($1, $2, $3::jsonb, $4) as id", [
        location, purposes[n % purposes.length], JSON.stringify(lines), null,
      ]);
      return rows[0].id;
    });
    if (finalStatus === "submitted") continue;

    if (finalStatus === "cancelled") {
      await as(requester, daysAgo(d, 15), (c) => c.query("select inventory.cancel_request($1, $2)", [id, "Got these from the other lab instead"]));
      continue;
    }

    const recommend = finalStatus !== "not_recommended" && finalStatus !== "rejected";
    await as(validator, daysAgo(d, 14), (c) =>
      c.query("select inventory.review_request($1, $2, $3)", [
        id, recommend, recommend ? pick(["Quantities look right", "Needed for scheduled work", null]) : "Lab already has enough of these this week",
      ]));
    if (finalStatus === "recommended" || finalStatus === "not_recommended") continue;

    if (finalStatus === "rejected") {
      await as(superUser, daysAgo(d - 1, 10), (c) => c.query("select inventory.reject_request($1, $2)", [id, "Not recommended and not urgent — please combine with next week's order"]));
      continue;
    }

    // Approve; sometimes trim a quantity.
    const { rows: rl } = await pool.query("select id, requested_qty from inventory.request_lines where request_id = $1", [id]);
    const trimmed = rand() < 0.35 && rl.some((l) => l.requested_qty > 1);
    await as(superUser, daysAgo(d - 1, 11), (c) =>
      c.query("select inventory.approve_request($1, $2::jsonb, $3)", [
        id,
        trimmed ? JSON.stringify(rl.map((l, i) => ({ line_id: Number(l.id), approved_qty: i === 0 ? Math.max(1, l.requested_qty - 1) : l.requested_qty }))) : null,
        trimmed ? "Reduced the first line; balance next week" : null,
      ]));
    if (finalStatus === "approved") continue;

    if (finalStatus === "rejected_store") {
      await as(store, daysAgo(d - 2, 12), (c) => c.query("select inventory.reject_request($1, $2)", [id, "Batch expired on inspection — reordering, please raise again next week"]));
      continue;
    }
    await as(store, daysAgo(d - 2, between(11, 16)), (c) =>
      c.query("select inventory.fulfill_request($1, $2)", [id, pick(["Collected at the counter", "Delivered to the lab", null])]));
  }

  // ---- push a few items under their reorder level so alerts show
  await as(store, daysAgo(1, 17), async (c) => {
    const lows = [["GLV-M", 3], ["PIP-10", 4], ["TAQ", 1], ["COVER", 2], ["EXT-CORD", 0]];
    for (const [sku, target] of lows) {
      const i = bySku[sku];
      const where = coldSkus.has(sku) ? COLD : MAIN;
      const { rows } = await c.query("select quantity from inventory.stock_levels where item_id = $1 and location_id = $2", [i.id, where]);
      const have = rows[0]?.quantity ?? 0;
      if (have > target) {
        await c.query("select inventory.adjust_stock($1, $2, $3, $4)", [i.id, where, target - have, "Monthly count: usage not logged against requests"]);
      }
    }
  });

  const counts = (await pool.query(`select
      (select count(*) from inventory.items) items,
      (select count(*) from inventory.requests) requests,
      (select count(*) from inventory.stock_movements) movements,
      (select count(*) from inventory.low_stock) low,
      (select count(*) from inventory.audit_log) audit`)).rows[0];
  log("seeded:", JSON.stringify(counts));
}

// ------------------------------------------------------------------ seal
// Seed-only: the demo history was re-dated after it was written, which (as it
// should) breaks the audit seal. Rebuild the chain once so the demo starts
// with an intact log. Never do this on a real database.
async function resealAuditLog() {
  const c = await adminPool.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    await c.query(`do $$
      declare r record; v_hash bytea := sha256(convert_to('store-register audit log', 'UTF8'));
      begin
        for r in select * from inventory.audit_log order by seq loop
          update inventory.audit_log
             set prev_hash = v_hash,
                 hash = inventory_private.audit_digest(v_hash, r.seq, r.created_at, r.actor_id, r.actor_kind,
                          r.action, r.table_name, r.row_id, r.old_data, r.new_data, r.note, r.db_user)
           where id = r.id
           returning hash into v_hash;
        end loop;
        update inventory_private.audit_head set hash = v_hash where id = 1;
      end $$`);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

// ------------------------------------------------------------------ main
try {
  await migrate();
  const { rows } = await pool.query("select count(*)::int as n from inventory.profiles");
  if (rows[0].n > 0) {
    log("accounts already exist, skipping seed");
  } else {
    const ids = await createAccounts();
    await seed(ids);
    await resealAuditLog();
  }
  log("done");
  log(`app:     http://localhost:3000   (password for every demo account: ${DEMO_PASSWORD})`);
  if (DEMO_TOTP_SECRET) log(`2FA:     add key ${DEMO_TOTP_SECRET} to your authenticator app (or scan docker/demo-authenticator.png)`);
  log("emails:  http://localhost:8025");
  await pool.end();
  await adminPool.end();
  process.exit(0);
} catch (e) {
  console.error("[setup] FAILED:", e.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
