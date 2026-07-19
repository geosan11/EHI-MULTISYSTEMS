const fs = require('fs');
const files = [
  'src/components/views/CargoForm.tsx',
  'src/components/views/PackageForm.tsx',
  'src/components/views/MarketingWorkspace.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace `user,` with `user: propUser,` in the props destructuring
  content = content.replace(/(\{\s*[\s\S]*?)(\buser\b,)([\s\S]*?:\s*\{)/, '$1user: propUser,$3');

  // Insert the effectiveUser logic
  const componentMatch = content.match(/=>\s*\{/);
  if (componentMatch) {
    const insertPos = componentMatch.index + componentMatch[0].length;
    const injection = `
  const isAdmin = ['super_admin', 'admin', 'accountant'].includes(propUser.role);
  const [adminSelectedHub, setAdminSelectedHub] = useState(propUser.hub_id || 'LOS/Lagos');
  const user = isAdmin ? { ...propUser, hub_id: adminSelectedHub, hub: adminSelectedHub } : propUser;
`;
    content = content.slice(0, insertPos) + injection + content.slice(insertPos);
  }

  // Ensure CARGO_ROUTES is imported
  if (!content.includes('CARGO_ROUTES')) {
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+["']\.\.\/\.\.\/lib\/constants["']/;
    const match = content.match(importRegex);
    if (match) {
      content = content.replace(importRegex, `import { $1, CARGO_ROUTES } from "../../lib/constants"`);
    } else {
      content = 'import { CARGO_ROUTES } from "../../lib/constants";\n' + content;
    }
  }

  fs.writeFileSync(file, content);
  console.log('Patched ' + file);
}
