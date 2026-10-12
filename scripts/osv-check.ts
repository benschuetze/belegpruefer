/**
 * Checks every installed package version against OSV (osv.dev), which aggregates GitHub, npm and other
 * advisory databases. Fails on high/critical findings in packages that ship to the server; build tools are
 * reported but do not fail the run, since their input is our own code, not user data.
 */
import { execFileSync } from "node:child_process";

type Tree = {
  dependencies?: Record<string, Tree & { version?: string }>;
  devDependencies?: Record<string, Tree & { version?: string }>;
};

function collect(prodOnly: boolean): Set<string> {
  const args = ["list", "--json", "--depth", "Infinity", ...(prodOnly ? ["--prod"] : [])];
  const roots = JSON.parse(execFileSync("pnpm", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as Tree[];
  const found = new Set<string>();
  const walk = (node: Tree) => {
    for (const deps of [node.dependencies, node.devDependencies]) {
      for (const [name, info] of Object.entries(deps ?? {})) {
        if (info.version && !info.version.startsWith("link:")) found.add(`${name}@${info.version}`);
        walk(info);
      }
    }
  };
  for (const root of roots) walk(root);
  return found;
}

const prod = collect(true);
const all = [...collect(false)];
const findings: { pkg: string; id: string; severity: string; summary: string; shipped: boolean }[] = [];

for (let i = 0; i < all.length; i += 500) {
  const chunk = all.slice(i, i + 500);
  const queries = chunk.map((p) => {
    const at = p.lastIndexOf("@");
    return { package: { name: p.slice(0, at), ecosystem: "npm" }, version: p.slice(at + 1) };
  });
  const res = await fetch("https://api.osv.dev/v1/querybatch", { method: "POST", body: JSON.stringify({ queries }) });
  if (!res.ok) throw new Error(`OSV nicht erreichbar: HTTP ${res.status}`);
  const { results } = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
  for (const [j, r] of results.entries()) {
    for (const v of r.vulns ?? []) {
      const detail = (await (await fetch(`https://api.osv.dev/v1/vulns/${v.id}`)).json()) as {
        summary?: string;
        database_specific?: { severity?: string };
      };
      const pkg = chunk[j] ?? "?";
      findings.push({
        pkg,
        id: v.id,
        severity: detail.database_specific?.severity ?? "UNKNOWN",
        summary: detail.summary ?? "",
        shipped: prod.has(pkg),
      });
    }
  }
}

console.log(`${all.length} Pakete geprüft (${prod.size} werden ausgeliefert), ${findings.length} Treffer`);
for (const f of findings) {
  console.log(
    `${f.shipped ? "AUSGELIEFERT" : "nur Build   "} ${f.severity.padEnd(9)} ${f.pkg} ${f.id} ${f.summary.slice(0, 80)}`,
  );
}
const blocking = findings.filter((f) => f.shipped && ["HIGH", "CRITICAL", "UNKNOWN"].includes(f.severity));
if (blocking.length > 0) {
  console.error(`\n${blocking.length} ernste Lücke(n) in ausgelieferten Paketen. Update oder Override nötig.`);
  process.exit(1);
}
