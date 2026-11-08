/**
 * Frontend API client for Paystack Billing and Entitlement Endpoints
 */

import { supabase } from './supabase';
import { PlanId } from '../config/cloudLockConfig';

export interface EntitlementResponse {
  isActive: boolean;
  isPermanent: boolean;
  plan: string;
  paidUntil: string | null;
  status: string;
  serverTime: string;
}

export interface CheckoutInitResponse {
  reference: string;
  authorizationUrl: string;
  plan: {
    id: PlanId;
    name: string;
    amountKobo: number;
    amountNgn: number;
    currency: string;
  };
}

export interface VerifyReferenceResponse {
  success: boolean;
  reference: string;
  plan?: string;
  isActive?: boolean;
  isPermanent?: boolean;
  paidUntil?: string | null;
  status?: string;
  requiresManualResolution?: boolean;
  message?: string;
  error?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // If offline or unable to read session, proceed with headers as-is
  }
  return headers;
}

/**
 * Queries current authoritative entitlement status from server singleton.
 */
export async function fetchEntitlementStatus(): Promise<EntitlementResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/billing/entitlement', {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch entitlement: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Initiates Paystack checkout on the server.
 * Returns unique reference and allowlisted authorization URL.
 */
export async function initializeBillingCheckout(planId: PlanId): Promise<CheckoutInitResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/billing/initialize', {
    method: 'POST',
    headers,
    body: JSON.stringify({ planId }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to initialize checkout');
  }

  return data;
}

/**
 * Verifies transaction reference server-side and checks entitlement unlock.
 */
export async function verifyBillingReference(reference: string): Promise<VerifyReferenceResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/billing/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers,
  });

  const data = await response.json();
  return data;
}
