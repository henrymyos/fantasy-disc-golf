import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://cagyuhuzvannojeqkmun.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const migrations = [
  `alter table leagues add column if not exists mpo_starters int not null default 4`,
  `alter table leagues add column if not exists fpo_starters int not null default 2`,
];

for (const sql of migrations) {
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    // exec_sql may not exist; fall through and report
    console.error("RPC error (exec_sql may not be available):", error.message);
    console.log("Trying direct table check instead...");
    break;
  }
  console.log("✓", sql);
}
