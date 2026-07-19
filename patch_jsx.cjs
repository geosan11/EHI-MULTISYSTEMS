const fs = require('fs');

const jsx = `
      {isAdmin && (
        <div className="mb-4 p-3 bg-[var(--color-surface-2)] rounded-lg border border-[var(--color-accent-amber)] border-opacity-30 animate-in fade-in">
           <label className="text-[10px] uppercase font-bold text-[var(--color-accent-amber)] mb-1 block flex items-center gap-1">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
             Admin: Global Hub Context
           </label>
           <select value={adminSelectedHub} onChange={(e) => setAdminSelectedHub(e.target.value)} className="w-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] font-bold text-[13px] p-2 rounded border border-[var(--color-border)] focus:border-[var(--color-accent-amber)] focus:outline-none cursor-pointer">
             {CARGO_ROUTES.map(route => <option key={route} value={route}>{route}</option>)}
           </select>
        </div>
      )}
`;

// CargoForm
let cargo = fs.readFileSync('src/components/views/CargoForm.tsx', 'utf8');
cargo = cargo.replace('<div className="px-4 pt-4">', '<div className="px-4 pt-4">\n' + jsx);
fs.writeFileSync('src/components/views/CargoForm.tsx', cargo);

// PackageForm
let pkg = fs.readFileSync('src/components/views/PackageForm.tsx', 'utf8');
pkg = pkg.replace('<div className="flex justify-between items-center text-[10px] font-mono', jsx + '\n      <div className="flex justify-between items-center text-[10px] font-mono');
fs.writeFileSync('src/components/views/PackageForm.tsx', pkg);

// MarketingWorkspace
let mkt = fs.readFileSync('src/components/views/MarketingWorkspace.tsx', 'utf8');
mkt = mkt.replace('{/* Top Navigation / Progress Indicator */}', jsx + '\n      {/* Top Navigation / Progress Indicator */}');
fs.writeFileSync('src/components/views/MarketingWorkspace.tsx', mkt);

console.log("Injected JSX");
