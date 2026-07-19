const fs = require('fs');
let content = fs.readFileSync('src/components/views/CargoForm.tsx', 'utf8');

// 1. Import
if (!content.includes('ReviewEntryModal')) {
  content = content.replace(
    'import { QRCode } from "../QRCode";',
    'import { QRCode } from "../QRCode";\nimport { ReviewEntryModal } from "./ReviewEntryModal";'
  );
}

// 2. Add state inside CargoForm
if (!content.includes('showRetailReview')) {
  content = content.replace(
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);',
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);\n  const [showRetailReview, setShowRetailReview] = useState(false);'
  );
}

// 3. Change onClick
content = content.replace(
  'onClick={handleRetailSubmit}',
  'onClick={() => setShowRetailReview(true)}'
);

// 4. Render the modal inside the component
const modalJSX = `
      {showRetailReview && (
        <ReviewEntryModal
          title="Review Retail Cargo Entry"
          details={[
            { label: 'Customer', value: name },
            { label: 'Route', value: route },
            { label: 'Content', value: contentType === 'Other' ? customContents : contentType },
            { label: 'Weight', value: \`\${weight} KG (\${pieces} pieces)\` },
            { label: 'Amount', value: computedCost },
            { label: 'Payment Mode', value: mode }
          ]}
          onConfirm={() => {
            setShowRetailReview(false);
            handleRetailSubmit();
          }}
          onCancel={() => setShowRetailReview(false)}
          confirmText="Log Cargo Entry"
          isSubmitting={submitting}
        />
      )}
`;

if (!content.includes('showRetailReview &&')) {
  content = content.replace(
    '{submitting && (',
    `${modalJSX}\n      {submitting && (`
  );
}

fs.writeFileSync('src/components/views/CargoForm.tsx', content);
console.log('CargoForm patched');
