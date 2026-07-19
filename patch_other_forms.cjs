const fs = require('fs');

// --- MarketingWorkspace.tsx ---
let mktgContent = fs.readFileSync('src/components/views/MarketingWorkspace.tsx', 'utf8');

if (!mktgContent.includes('ReviewEntryModal')) {
  mktgContent = mktgContent.replace(
    'import { QRCode } from "../QRCode";',
    'import { QRCode } from "../QRCode";\nimport { ReviewEntryModal } from "./ReviewEntryModal";'
  );
}

if (!mktgContent.includes('showMarketingReview')) {
  mktgContent = mktgContent.replace(
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);',
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);\n  const [showMarketingReview, setShowMarketingReview] = useState(false);'
  );
}

mktgContent = mktgContent.replace(
  'onClick={handleAddEntry}',
  'onClick={() => setShowMarketingReview(true)}'
);

const mktgModalJSX = `
      {showMarketingReview && (
        <ReviewEntryModal
          title="Review Marketing Entry"
          details={[
            { label: 'Customer', value: name },
            { label: 'Content', value: contentType === 'Other' ? customContents : contentType },
            { label: 'Weight', value: \`\${totalKg} KG (\${totalPieces} pieces)\` },
            { label: 'Amount', value: parseFloat(amountOverride) || minAmount },
            { label: 'Payment Mode', value: mode === 'Debt' ? \`Debt (\${debtorName})\` : mode }
          ]}
          onConfirm={() => {
            setShowMarketingReview(false);
            handleAddEntry();
          }}
          onCancel={() => setShowMarketingReview(false)}
          confirmText="Add Entry"
          isSubmitting={submitting}
        />
      )}
`;

if (!mktgContent.includes('showMarketingReview &&')) {
  mktgContent = mktgContent.replace(
    '{submitting && <Loader2 size={16} className="animate-spin" />}',
    `${mktgModalJSX}\n                  {submitting && <Loader2 size={16} className="animate-spin" />}`
  );
}

fs.writeFileSync('src/components/views/MarketingWorkspace.tsx', mktgContent);

// --- ExcessBaggageForm.tsx ---
let bagContent = fs.readFileSync('src/components/views/ExcessBaggageForm.tsx', 'utf8');

if (!bagContent.includes('ReviewEntryModal')) {
  bagContent = bagContent.replace(
    'import { PrintModal } from "./PrintModal";',
    'import { PrintModal } from "./PrintModal";\nimport { ReviewEntryModal } from "./ReviewEntryModal";'
  );
}

if (!bagContent.includes('showBaggageReview')) {
  bagContent = bagContent.replace(
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);',
    'const [isOffline, setIsOffline] = useState(!navigator.onLine);\n  const [showBaggageReview, setShowBaggageReview] = useState(false);'
  );
}

bagContent = bagContent.replace(
  'onClick={handleSubmit}',
  'onClick={() => setShowBaggageReview(true)}'
);

const bagModalJSX = `
      {showBaggageReview && (
        <ReviewEntryModal
          title="Review Baggage Entry"
          details={[
            { label: 'Passenger', value: passengerName },
            { label: 'Flight', value: flightNumber },
            { label: 'Weight', value: \`\${weight} KG\` },
            { label: 'Amount', value: parseFloat(amount) || 0 },
            { label: 'Payment Mode', value: mode }
          ]}
          onConfirm={() => {
            setShowBaggageReview(false);
            handleSubmit();
          }}
          onCancel={() => setShowBaggageReview(false)}
          confirmText="Log Payment"
          isSubmitting={submitting}
        />
      )}
`;

if (!bagContent.includes('showBaggageReview &&')) {
  bagContent = bagContent.replace(
    '{submitting && <Loader2 size={16} className="animate-spin" />}',
    `${bagModalJSX}\n                  {submitting && <Loader2 size={16} className="animate-spin" />}`
  );
}

fs.writeFileSync('src/components/views/ExcessBaggageForm.tsx', bagContent);

console.log('Other forms patched');
