const fs = require('fs');
let content = fs.readFileSync('src/components/views/PackageForm.tsx', 'utf8');

// 1. Import
if (!content.includes('ReviewEntryModal')) {
  content = content.replace(
    'import { QRCode } from "../QRCode";',
    'import { QRCode } from "../QRCode";\nimport { ReviewEntryModal } from "./ReviewEntryModal";'
  );
}

// 2. Add state
if (!content.includes('showPackageReview')) {
  content = content.replace(
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);',
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);\n  const [showPackageReview, setShowPackageReview] = useState(false);'
  );
}

// 3. Change onClick
content = content.replace(
  'onClick={handleAddEntry}',
  'onClick={() => setShowPackageReview(true)}'
);

// 4. Render modal inside component
const modalJSX = `
      {showPackageReview && (
        <ReviewEntryModal
          title="Review Package/Mail Entry"
          details={[
            { label: 'Customer', value: name },
            { label: 'Content', value: contentType === 'Other' ? customContents : contentType },
            { label: 'Amount', value: parseFloat(amount) || 0 },
            { label: 'Payment Mode', value: mode === 'Debt' ? \`Debt (\${debtorName})\` : mode }
          ]}
          onConfirm={() => {
            setShowPackageReview(false);
            handleAddEntry();
          }}
          onCancel={() => setShowPackageReview(false)}
          confirmText="Log Package"
          isSubmitting={submitting}
        />
      )}
`;

if (!content.includes('showPackageReview &&')) {
  content = content.replace(
    '{submitting && <Loader2 size={16} className="animate-spin" />}',
    `${modalJSX}\n                  {submitting && <Loader2 size={16} className="animate-spin" />}`
  );
}

fs.writeFileSync('src/components/views/PackageForm.tsx', content);
console.log('PackageForm patched');
