const fs = require('fs');

let content = fs.readFileSync('src/components/views/Analytics.tsx', 'utf8');

const regex = /\{\/\* Uncollected & Outstanding Debt \*\/\}([\s\S]*?)<\/div>\s*<\/div>\s*\}\)/;

const newBlock = `{/* Non-Liquid & Excluded Volumes */}
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
            <h3 className="text-[13px] font-bold font-sans text-[var(--color-foreground)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <AlertCircle size={16} className="text-[var(--color-error)]" />
              <span>Non-Liquid & Excluded Volumes</span>
            </h3>

            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Active Corporate / Waybill Debt:</span>
                <span className="text-[var(--color-error)] font-bold">₦{fmt(metrics.debtOutstanding)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Office Work Volume (Excluded from Liquid):</span>
                <span className="text-[var(--color-purple)] font-bold">₦{fmt(metrics.officeWorkValue)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Retrieved Packages Value (Refunded):</span>
                <span className="text-[var(--color-muted)] font-bold line-through">₦{fmt(metrics.retrievedValue)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Unconfirmed Bank Transfers:</span>
                <span className="text-[var(--color-accent-amber)] font-bold">₦{fmt(metrics.unconfirmedTransfers)}</span>
              </div>
              <div className="flex justify-between p-2.5 bg-[var(--color-surface-1)] rounded-lg border border-[var(--color-border)]">
                <span className="text-[var(--color-muted)]">Unverified Cash Entries:</span>
                <span className="text-[var(--color-accent-amber)] font-bold">₦{fmt(metrics.unverifiedCash)}</span>
              </div>
            </div>
          </div>
        </div>
      )}`;

content = content.replace(regex, newBlock);

fs.writeFileSync('src/components/views/Analytics.tsx', content);
console.log('Analytics UI updated');
