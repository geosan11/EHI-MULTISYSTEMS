/**
 * Billing Callback Page (/billing/callback)
 *
 * Processes redirect back from Paystack checkout:
 * 1. Extracts transaction reference from URL query params.
 * 2. Invokes server-side verification endpoint /api/billing/verify/:reference.
 *    (Query strings or local flags NEVER grant access on their own).
 * 3. Shows real-time verification progress, success confirmation with expiry,
 *    or manual billing resolution advisory for late bridge confirmations.
 * 4. Exempt from the CloudPausedGate overlay.
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { verifyBillingReference, type VerifyReferenceResponse } from '../lib/billingApi';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, ArrowRight } from 'lucide-react';
import ehiLogoImg from '../assets/branding/ehi-logo.png';

export function BillingCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const reference = searchParams.get('reference') || searchParams.get('trxref') || '';

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerifyReferenceResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (!reference) {
      setLoading(false);
      setErrorMsg('No payment transaction reference found in callback URL.');
      return;
    }

    async function performVerification() {
      try {
        setLoading(true);
        setErrorMsg(null);
        const data = await verifyBillingReference(reference);
        if (isCancelled) return;

        setResult(data);
        if (!data.success && !data.requiresManualResolution) {
          setErrorMsg(data.error || 'Transaction verification could not be confirmed.');
        }
      } catch (err: any) {
        if (isCancelled) return;
        setErrorMsg(err.message || 'An error occurred while contacting the verification service.');
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    performVerification();

    return () => {
      isCancelled = true;
    };
  }, [reference]);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#111827] border border-gray-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-6 text-center">
          <img src={ehiLogoImg} alt="EHI Logo" className="h-10 w-auto mb-3 object-contain" />
          <h1 className="text-sm font-semibold tracking-wider text-gray-400 uppercase">
            EHI Multisystems Billing Verification
          </h1>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center py-8 text-center space-y-4">
            <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
            <div>
              <h2 className="text-lg font-semibold text-gray-100">Verifying Payment with Server</h2>
              <p className="text-xs text-gray-400 mt-1">
                Confirming Paystack transaction reference <span className="font-mono text-gray-300">{reference}</span>...
              </p>
            </div>
          </div>
        )}

        {/* Success State */}
        {!loading && result?.success && (
          <div className="flex flex-col items-center py-4 text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-100">Payment Verified Successfully</h2>
              <p className="text-sm text-emerald-400/90 font-medium mt-1">
                Company Entitlement Active
              </p>
            </div>

            <div className="w-full bg-[#1A2234] border border-gray-800 rounded-xl p-4 text-left text-xs space-y-2 mt-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Plan:</span>
                <span className="font-semibold text-gray-200 capitalize">
                  {result.plan?.replace('-', ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Coverage:</span>
                <span className="font-semibold text-gray-200">
                  {result.isPermanent
                    ? 'Permanent System Handover'
                    : result.paidUntil
                    ? new Date(result.paidUntil).toLocaleString('en-GB', {
                        timeZone: 'Africa/Lagos',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : 'Active'}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-800 pt-2">
                <span className="text-gray-400">Reference:</span>
                <span className="font-mono text-gray-300 truncate max-w-[180px]">
                  {result.reference}
                </span>
              </div>
            </div>

            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-amber-500/10 cursor-pointer"
            >
              <span>Continue to Operations</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Late Bridge Confirmation (Manual Resolution Required) */}
        {!loading && result?.requiresManualResolution && (
          <div className="flex flex-col items-center py-4 text-center space-y-4">
            <div className="w-14 h-14 bg-amber-500/10 border border-amber-500/30 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-100">Manual Resolution Required</h2>
              <p className="text-xs text-amber-300 mt-1">
                Late Bridge Payment Confirmed
              </p>
            </div>

            <div className="w-full bg-[#1A2234] border border-amber-500/30 rounded-xl p-4 text-left text-xs text-gray-300 space-y-2">
              <p className="font-medium text-amber-200">
                Payment was confirmed after the 30 Nov 2026 cutoff date.
              </p>
              <p className="text-gray-400 leading-relaxed">
                Under system policy, November Cloud Bridge entitlements cannot be granted after expiry.
                Your payment of ₦63,000 has been securely recorded under reference{' '}
                <span className="font-mono text-gray-200">{reference}</span>.
                No automatic refund is initiated. Please contact your system administrator or billing support
                to apply this credit toward a monthly licence or system handover.
              </p>
            </div>

            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold py-3 px-4 rounded-xl transition-all cursor-pointer"
            >
              <span>Return to Application</span>
            </button>
          </div>
        )}

        {/* Error / Failure State */}
        {!loading && !result?.success && !result?.requiresManualResolution && (
          <div className="flex flex-col items-center py-4 text-center space-y-4">
            <div className="w-14 h-14 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-100">Verification Unsuccessful</h2>
              <p className="text-xs text-red-400 mt-1">
                {errorMsg || 'The payment could not be verified by the server.'}
              </p>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              If your card was debited, Paystack webhooks will automatically retry confirmation,
              or you may retry verification in a moment.
            </p>

            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold py-3 px-4 rounded-xl transition-all cursor-pointer"
            >
              <span>Return to Pricing Options</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
