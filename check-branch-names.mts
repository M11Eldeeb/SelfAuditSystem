import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) process.env[match[1]] ??= match[2];
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: branches } = await supabase.from("branches").select("id, name, code, active").order("name");
  console.log("branches table:");
  console.table(branches);

  const { data: users } = await supabase.from("users").select("id, email, full_name, role, branch_id");
  console.log("\nusers table:");
  console.table(users);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
